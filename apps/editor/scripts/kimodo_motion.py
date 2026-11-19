import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


MODEL = "Kimodo-SOMA-RP-ArdyRep-v1.2"
FPS = 30


def encode_motion(data, prompt, seed):
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
    if not 1 <= count <= 300 or roots.shape != (count, 3) or global_rotations.shape != (count, 77, 3, 3) or root_heading.shape != (count, 2):
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
        "prompt": prompt,
        "seed": seed,
        "fps": FPS,
        "joints": skeleton.bone_order_names,
        "jointParents": parents,
        "jointOffsets": offsets.round(7).tolist(),
        "frames": [
            {"rootPosition": position, "rootRotation": local[0], "rootHeading": heading, "localRotations": local}
            for position, heading, local in zip(roots.tolist(), headings, rounded_local, strict=True)
        ],
    }


def write_motion(output, data, prompt, seed):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(encode_motion(data, prompt, seed), allow_nan=False, separators=(",", ":")), encoding="utf-8")


def load_generator():
    import torch
    from kimodo import load_model

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    model, name = load_model(MODEL, device=device, default_family="Kimodo", return_resolved_name=True)
    print(f"Loaded {name} on {device}", flush=True)
    if model.fps != FPS:
        raise ValueError("Unexpected SOMA motion frame rate")
    return model


def generate_motion(model, prompt, seconds, seed):
    from kimodo.tools import seed_everything

    seed_everything(seed)
    output = model(
        [prompt],
        [round(seconds * model.fps)],
        constraint_lst=[],
        num_denoising_steps=40,
        num_samples=1,
        multi_prompt=True,
        post_processing=False,
        return_numpy=True,
    )
    return {key: output[key][0] for key in ("root_positions", "global_rot_mats", "global_root_heading")}


def main():
    parser = argparse.ArgumentParser(description="Generate or export Kimodo SOMA-77 motion for SceneForge.")
    parser.add_argument("output", type=Path)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--seconds", type=float, default=4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--npz", type=Path)
    args = parser.parse_args()
    if not 0 < len(args.prompt.strip()) <= 500 or not 0.5 <= args.seconds <= 10 or not 0 <= args.seed <= 2147483647:
        parser.error("Use a prompt of 1 to 500 characters, 0.5 to 10 seconds and a nonnegative 32-bit seed.")
    if args.npz:
        with np.load(args.npz, allow_pickle=False) as data:
            write_motion(args.output, data, args.prompt, args.seed)
    else:
        write_motion(args.output, generate_motion(load_generator(), args.prompt, args.seconds, args.seed), args.prompt, args.seed)


if __name__ == "__main__":
    main()
