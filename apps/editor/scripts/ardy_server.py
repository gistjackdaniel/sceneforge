"""Stream ARDY motion for SceneForge's live steering: one JSON request per stdin line, one JSON reply per stdout line.

Requests:
  {"id", "type": "start", "prompt"}                      reset, encode the prompt, generate the first window
  {"id", "type": "step", "frame", "velocity": [x, z], "prompt"?}
      replan from a few frames past the client's playback frame, steering the root toward the target velocity
  {"id", "type": "clip", "from", "to"}                    the frames [from, to) as a SceneForge SOMA motion
Replies carry the request id and either "error" or the frames from "start" onward, in the motion's own frame:
metres with the actor facing +Z at frame 0, as SceneForge places Kimodo clips.
"""

import json
import math
import os
import sys
import time

os.environ.setdefault("HF_HUB_CACHE", os.path.expanduser("~/hf-cache/hub"))
# ARDY builds the text encoder on CUDA before moving it to the requested device, leaving 14 GiB reserved on the GPU.
# The wrapper honours this variable at construction, so the 15 GB encoder never touches the GPU.
os.environ["TEXT_ENCODER_DEVICE"] = "cpu"

MODEL = "soma-kimodo"
MODEL_NAME = "ARDY-SOMA-RP-30FPS-KimodoRep-Horizon60"
FPS = 30
DENOISING_STEPS = 10  # The released checkpoint fails an index assertion at 20.
CFG = (2.0, 2.0)
REPLAN_BUFFER = 6  # frames the client keeps playing while a step runs
HISTORY = 60  # frames of history the model sees
WAYPOINT_EVERY = 10  # frames between the 2D root waypoints that steer toward the target velocity
VELOCITY_RAMP = 2.0  # seconds to blend from the current to the target velocity, as ARDY's demo does
STANDING = 0.05  # m/s under which the target holds the root in place


def log(message):
    print(message, file=sys.stderr, flush=True)


class Stream:
    def __init__(self):
        import torch
        from ardy.model.load_model import load_model, load_text_encoder

        self.torch = torch
        started = time.time()
        encoder = load_text_encoder(mode="local", device="cpu")
        self.model = load_model(MODEL, device="cuda", text_encoder=encoder)
        self.rep = self.model.motion_rep
        self.skeleton = self.rep.skeleton
        self.wide = self.skeleton.somaskel77
        self.horizon = self.model.gen_horizon_len
        self.token = self.model.denoiser.num_frames_per_token
        self.prompts = {}
        self.samples = None
        self.output = None
        log(f"ARDY ready in {time.time() - started:.1f} s, {torch.cuda.memory_allocated() / 2**30:.1f} GiB on the GPU")

    def text(self, prompt):
        if prompt not in self.prompts:
            feature, _ = self.model._encode_text([prompt])
            self.prompts = {prompt: feature}
        feature = self.prompts[prompt]
        return feature, self.torch.ones(feature.shape[0], feature.shape[1], device=self.model.device, dtype=self.torch.bool)

    def decode(self, samples):
        return self.skeleton.output_to_SOMASkeleton77(self.rep.inverse(self.rep.unnormalize(samples), is_normalized=False))

    def start(self, prompt):
        self.prompt = prompt
        feature, mask = self.text(prompt)
        with self.torch.no_grad():
            self.samples = self.model.autoregressive_step(
                num_frames=self.horizon, num_denoising_steps=DENOISING_STEPS, motion_mask=None, observed_motion=None,
                cfg_weight=CFG, text_feat=feature, text_pad_mask=mask)
            self.output = self.decode(self.samples)
        return 0

    def steering(self, history_start, history_end, num_frames, velocity):
        """2D root waypoints ahead of the history, ramping from the current root velocity to the target."""
        torch = self.torch
        from einops import repeat
        from ardy.constraints import Root2DConstraintSet

        roots = self.output["root_positions"][0]
        here = roots[history_end]
        current = (here - roots[max(history_end - 1, 0)]) * FPS
        target = torch.tensor([velocity[0], 0.0, velocity[1]], device=here.device)
        standing = math.hypot(*velocity) < STANDING
        frames, points = [], []
        position = here.clone()
        ramp = int(VELOCITY_RAMP * FPS)
        for step in range(1, self.horizon + 1):
            blend = min(step / ramp, 1.0)
            position = here if standing else position + ((1 - blend) * current + blend * target) / FPS
            if step % WAYPOINT_EVERY == 0:
                frames.append(history_end - history_start + step)
                points.append([position[0].item(), position[2].item()])
        constraint = Root2DConstraintSet(self.skeleton, torch.tensor(frames),
                                         torch.tensor(points, dtype=torch.float32, device=self.model.device))
        observed, mask = self.rep.create_conditions_from_constraints([constraint], length=num_frames, to_normalize=False,
                                                                       device=self.model.device)
        observed = self.rep.normalize(observed) * mask
        return repeat(mask, "t d -> b t d", b=1), repeat(observed, "t d -> b t d", b=1)

    def step(self, frame, velocity, prompt):
        if prompt and prompt != self.prompt:
            self.prompt = prompt
        total = self.samples.shape[1]
        history_end = max(min(total - 1, frame + REPLAN_BUFFER), self.token - 1)
        length = min(history_end + 1, HISTORY) // self.token * self.token
        history_start = history_end - length + 1
        num_frames = length + self.horizon
        mask, observed = self.steering(history_start, history_end, num_frames, velocity)
        mask[:, :length] = 0.0
        observed[:, :length] = 0.0
        feature, text_mask = self.text(self.prompt)
        with self.torch.no_grad():
            samples = self.model.autoregressive_step(
                num_frames=num_frames, num_denoising_steps=DENOISING_STEPS, motion_mask=mask, observed_motion=observed,
                cfg_weight=CFG, text_feat=feature, text_pad_mask=text_mask,
                init_history_sequence=self.samples[:, history_start:history_end + 1])
            output = self.decode(samples)
        cat = self.torch.cat
        self.samples = cat([self.samples[:, :history_end + 1], samples[:, length:]], dim=1)
        self.output = {key: cat([self.output[key][:, :history_end + 1], output[key][:, length:]], dim=1)
                       for key in ("root_positions", "global_rot_mats", "global_root_heading")}
        return history_end + 1

    def frames(self, first, last=None):
        """SceneForge SOMA frames: effective local rotations as xyzw quaternions, root position, and heading."""
        import numpy as np
        from scipy.spatial.transform import Rotation

        parents = self.parents()
        roots = self.output["root_positions"][0, first:last].cpu().numpy()
        rotations = self.output["global_rot_mats"][0, first:last].cpu().numpy()
        heading = self.output["global_root_heading"][0, first:last].cpu().numpy()
        local = rotations.copy()
        local[:, 1:] = rotations[:, parents[1:]].transpose(0, 1, 3, 2) @ rotations[:, 1:]
        quats = Rotation.from_matrix(local.reshape(-1, 3, 3)).as_quat().reshape(len(roots), -1, 4).round(7).tolist()
        headings = np.arctan2(heading[:, 1], heading[:, 0]).tolist()
        return [{"rootPosition": root, "rootRotation": quat[0], "rootHeading": angle, "localRotations": quat}
                for root, angle, quat in zip(roots.round(6).tolist(), headings, quats)]

    def parents(self):
        return [self.wide.bone_index[parent] if parent else -1 for _, parent in self.wide.bone_order_names_with_parents]

    def skeleton_json(self):
        parents = self.parents()
        offsets = self.wide.neutral_joints.cpu().numpy().copy()
        offsets[1:] -= offsets[parents[1:]]
        offsets[0] = 0
        return {"joints": self.wide.bone_order_names, "jointParents": parents, "jointOffsets": offsets.round(7).tolist()}

    def clip(self, first, last):
        if not 0 <= first < last <= self.samples.shape[1] or last - first > 300:
            raise ValueError("Save between 1 and 300 frames that were generated.")
        return {"schemaVersion": 1, "model": MODEL_NAME, "prompt": self.prompt, "seed": 0, "fps": FPS,
                **self.skeleton_json(), "frames": self.frames(first, last)}


def main():
    # Libraries print to stdout while loading; keep that channel for replies only.
    replies = sys.stdout
    sys.stdout = sys.stderr
    stream = None
    for line in sys.stdin:
        if not line.strip():
            continue
        request = {}
        try:
            request = json.loads(line)
            started = time.time()
            if stream is None:
                stream = Stream()
            kind = request["type"]
            if kind == "start":
                first = stream.start(str(request["prompt"]).strip() or "A person walks.")
                reply = {"start": first, "frames": stream.frames(first), **stream.skeleton_json()}
            elif kind == "step":
                velocity = [float(value) for value in request["velocity"]][:2]
                first = stream.step(int(request["frame"]), velocity, request.get("prompt"))
                reply = {"start": first, "frames": stream.frames(first)}
            elif kind == "clip":
                reply = {"clip": stream.clip(int(request["from"]), int(request["to"]))}
            else:
                raise ValueError(f"Unknown request {kind}")
            reply["seconds"] = round(time.time() - started, 3)
        except Exception as error:  # noqa: BLE001 - every failure goes back to the editor as a reply
            log(f"ARDY request failed: {error!r}")
            reply = {"error": str(error)}
        print(json.dumps({"id": request.get("id"), **reply}, allow_nan=False, separators=(",", ":")), file=replies, flush=True)


if __name__ == "__main__":
    main()
