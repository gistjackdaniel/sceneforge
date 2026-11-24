"""Skin a Pixal3D GLB and transfer the ICT-FaceKit expression set locally."""

import argparse
import os
import sys
from pathlib import Path
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-dir", type=Path, required=True)
    parser.add_argument("--mia-dir", type=Path, required=True)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--mesh", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    os.environ["MIA_DIR"] = str(args.mia_dir)
    sys.path.insert(0, str(args.worker_dir))
    import engine_mia
    import numpy as np
    import rig_glb
    from blendshapes import head_mask_from_weights, load_template, transfer_blendshapes

    mesh_bytes = args.mesh.read_bytes()
    rig_glb.validate_input_mesh(mesh_bytes)
    template = load_template(str(args.template))
    if set(template["names"]) != set(rig_glb.ARKIT_52_BLENDSHAPES):
        raise ValueError("Expected an ARKit-52 face template")

    engine_mia.init()
    predicted = engine_mia.predict(str(args.mesh))
    vertices = predicted["verts"]
    weights = predicted["weights"]
    names = predicted["names"]

    head = head_mask_from_weights(weights, names)
    expressions = transfer_blendshapes(template, vertices, head)
    deltas = expressions["deltas"]
    required = ("eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight")
    for name in required:
        shape = deltas[expressions["names"].index(name)]
        if not np.isfinite(shape).all() or not np.any(np.abs(shape) > 1e-7):
            raise ValueError(f"The reconstructed head could not be rigged for {name}")

    avatar = rig_glb.build_rigged_glb(
        mesh_bytes, SimpleNamespace(vertices=vertices), predicted["joints"], predicted["parents"],
        weights, blendshape_data=expressions, joint_names=names,
    )
    args.output.write_bytes(avatar)


if __name__ == "__main__":
    main()
