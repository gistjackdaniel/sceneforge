import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


MODEL = "Kimodo-SOMA-RP-ArdyRep-v1.2"
FPS = 30
MAX_FRAMES = 300


def summary(segments):
    return " · ".join(segment["prompt"] for segment in segments)


def encode_motion(data, request):
    from kimodo.skeleton import SOMASkeleton77

    skeleton = SOMASkeleton77(load=True)
    parents = [skeleton.bone_index[parent] if parent else -1
               for _, parent in skeleton.bone_order_names_with_parents]
    offsets = skeleton.neutral_joints.numpy().copy()
    offsets[1:] -= offsets[np.asarray(parents[1:])]
    offsets[0] = 0
    roots = data["root_positions"]
    global_rotations = data["global_rot_mats"]
    root_heading = data["global_root_heading"]
    count = len(roots)
    if not 1 <= count <= MAX_FRAMES or roots.shape != (count, 3) or global_rotations.shape != (count, 77, 3, 3) or root_heading.shape != (count, 2):
        raise ValueError("Expected a SOMA-77 motion with 1 to 300 frames")
    if not all(np.isfinite(values).all() for values in (roots, global_rotations, root_heading)):
        raise ValueError("SOMA motion contains non-finite values")

    effective_locals = global_rotations.copy()
    effective_locals[:, 1:] = global_rotations[:, parents[1:]].transpose(0, 1, 3, 2) @ global_rotations[:, 1:]
    rotations = Rotation.from_matrix(effective_locals.reshape(-1, 3, 3)).as_quat().reshape(-1, 77, 4)
    rounded_local = rotations.round(7).tolist()
    headings = np.arctan2(root_heading[:, 1], root_heading[:, 0]).tolist()
    return {
        "schemaVersion": 1,
        "model": MODEL,
        "prompt": summary(request["segments"]),
        "seed": request["seed"],
        "segments": request["segments"],
        "waypoints": request["waypoints"],
        "fps": FPS,
        "joints": skeleton.bone_order_names,
        "jointParents": parents,
        "jointOffsets": offsets.round(7).tolist(),
        "frames": [
            {"rootPosition": position, "rootRotation": local[0], "rootHeading": heading, "localRotations": local}
            for position, heading, local in zip(roots.tolist(), headings, rounded_local, strict=True)
        ],
    }


def write_motion(output, data, request):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(encode_motion(data, request), allow_nan=False, separators=(",", ":")), encoding="utf-8")


def load_generator():
    import torch
    from kimodo import load_model

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    model, name = load_model(MODEL, device=device, default_family="Kimodo", return_resolved_name=True)
    print(f"Loaded {name} on {device}", flush=True)
    if model.fps != FPS:
        raise ValueError("Unexpected SOMA motion frame rate")
    return model


def root_constraints(model, waypoints):
    """Pin the first frame to the origin facing +Z, then hold the root on each waypoint's ground point at its frame.

    The editor places a clip from its first frame and heading, so waypoints are given in that frame: metres on the
    ground, with the actor facing +Z at frame 0.
    """
    import torch
    from kimodo.constraints import Root2DConstraintSet

    class SegmentRoot2D(Root2DConstraintSet):
        """Kimodo crops every constraint into every prompt segment and fails on one left with no frames."""

        def crop_move(self, start, end):
            cropped = super().crop_move(start, end)
            return SegmentRoot2D(cropped.skeleton, cropped.frame_indices, cropped.smooth_root_2d,
                                 global_root_heading=cropped.global_root_heading)

        def update_constraints(self, data_dict, index_dict):
            if len(self.frame_indices):
                super().update_constraints(data_dict, index_dict)

    if not waypoints:
        return []
    start = SegmentRoot2D(model.skeleton, torch.tensor([0]), torch.zeros(1, 2), global_root_heading=torch.tensor([[1.0, 0.0]]))
    path = SegmentRoot2D(model.skeleton, torch.tensor([point["frame"] for point in waypoints]),
                         torch.tensor([[point["x"], point["z"]] for point in waypoints], dtype=torch.float32))
    return [start.to(model.device), path.to(model.device)]


def generate_motion(model, request):
    from kimodo.tools import seed_everything

    seed_everything(request["seed"])
    segments = request["segments"]
    output = model(
        [segment["prompt"] for segment in segments],
        [segment["frames"] for segment in segments],
        constraint_lst=root_constraints(model, request["waypoints"]),
        num_denoising_steps=40,
        num_samples=1,
        multi_prompt=True,
        post_processing=False,
        return_numpy=True,
    )
    return {key: output[key][0] for key in ("root_positions", "global_rot_mats", "global_root_heading")}


def read_request(path):
    """The editor server validates requests; this rejects anything that would not produce a valid clip."""
    request = json.loads(path.read_text(encoding="utf-8"))
    segments, waypoints = request["segments"], request["waypoints"]
    total = sum(segment["frames"] for segment in segments)
    if not segments or not 1 <= total <= MAX_FRAMES or not all(1 <= len(segment["prompt"].strip()) <= 500 for segment in segments):
        raise ValueError("Use 1 to 300 frames of prompts with 1 to 500 characters each.")
    frames = [point["frame"] for point in waypoints]
    if any(not 0 < frame < total for frame in frames) or frames != sorted(set(frames)):
        raise ValueError("Waypoints need increasing frames inside the clip, after its first frame.")
    if not 0 <= request["seed"] <= 2147483647:
        raise ValueError("Use a nonnegative 32-bit seed.")
    return {"segments": segments, "waypoints": waypoints, "seed": request["seed"]}


def main():
    parser = argparse.ArgumentParser(description="Generate or export Kimodo SOMA-77 motion for SceneForge.")
    parser.add_argument("output", type=Path)
    parser.add_argument("--request", type=Path, required=True, help="JSON with segments, waypoints and seed")
    parser.add_argument("--npz", type=Path, help="Export this Kimodo output instead of generating")
    args = parser.parse_args()
    request = read_request(args.request)
    if args.npz:
        with np.load(args.npz, allow_pickle=False) as data:
            write_motion(args.output, data, request)
    else:
        write_motion(args.output, generate_motion(load_generator(), request), request)


if __name__ == "__main__":
    main()
