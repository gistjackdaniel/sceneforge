"""Skin a Pixal3D GLB and transfer the ICT-FaceKit expression set locally."""

import argparse
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pygltflib
from scipy.spatial import cKDTree

# three.ws blendshapes.py falloff: a fraction of head height, cut off after three sigmas.
FALLOFF_SIGMA_RATIO = 0.08
FALLOFF_CUTOFF_SIGMAS = 3.0
# A cosine between a vertex normal and the direction away from a bone that counts as fully facing.
FACING_BAND = 0.25
# A triangle whose corners hold at least this much and at most 1 - this much of one arm joins that arm to the body.
BRIDGE_MASS = 0.9
COMPONENTS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTHS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}


def similarity(source, target):
    """Scale, rotation, and translation that best map source points onto target points (Umeyama)."""
    source_mean, target_mean = source.mean(axis=0), target.mean(axis=0)
    a, b = source - source_mean, target - target_mean
    u, d, vt = np.linalg.svd(b.T @ a / len(source))
    sign = np.diag([1.0, 1.0, np.sign(np.linalg.det(u @ vt))])
    rotation = u @ sign @ vt
    scale = np.trace(np.diag(d) @ sign) / a.var(axis=0).sum()
    return scale, rotation, target_mean - scale * rotation @ source_mean


def transfer_expressions(template, vertices, head_mask):
    """Copy each head vertex's ARKit deltas from the nearest template vertex, as three.ws transfer_blendshapes does.

    three.ws places the template by centroid and height. The template has a neck and the avatar's head region has
    hair, so on a Pixal3D head its face sat 6 cm behind the avatar's face and the distance falloff removed almost
    all of every expression. Start from the crown, the left-right centre, and the nose tip instead, then refine the
    fit with ICP on the template rows that move.
    """
    head = vertices[head_mask].astype(np.float64)
    if len(head) < 16:
        raise ValueError("The reconstructed head is too small to rig")
    template_vertices = template["verts"].astype(np.float64)
    deltas = template["deltas"]
    motion = np.linalg.norm(deltas, axis=2).max(axis=0)
    face = motion > 0.02 * motion.max()

    scale = np.ptp(head[:, 0]) / np.ptp(template_vertices[:, 0])
    placed = template_vertices * scale
    placed += [head[:, 0].mean() - placed[:, 0].mean(), head[:, 1].max() - placed[:, 1].max(), 0.0]
    nose = placed[face][np.argmax(placed[face, 2])]
    around_nose = (np.abs(head[:, 1] - nose[1]) < 0.08 * np.ptp(head[:, 1])) & (np.abs(head[:, 0] - nose[0]) < 0.1 * np.ptp(head[:, 0]))
    if not around_nose.any():
        raise ValueError("The reconstructed head has no face where the template's nose is")
    placed[:, 2] += head[around_nose, 2].max() - nose[2]

    rotation = np.eye(3)
    tree = cKDTree(head)
    for _ in range(40):
        distance, nearest = tree.query(placed[face])
        close = distance < 3 * np.median(distance)
        step_scale, step_rotation, step_translation = similarity(placed[face][close], head[nearest[close]])
        placed = step_scale * placed @ step_rotation.T + step_translation
        scale *= step_scale
        rotation = step_rotation @ rotation

    distance, nearest = cKDTree(placed).query(head)
    sigma = max(FALLOFF_SIGMA_RATIO * np.ptp(head[:, 1]), 1e-6)
    falloff = np.exp(-((distance / sigma) ** 2)) * (distance <= FALLOFF_CUTOFF_SIGMAS * sigma)
    out = np.zeros((len(template["names"]), len(vertices), 3), dtype=np.float32)
    out[:, head_mask] = scale * deltas[:, nearest] @ rotation.T * falloff[None, :, None]
    return {"names": template["names"], "deltas": out}


def accessor_view(glb, blob, index):
    """A writable view of a tightly packed accessor inside the GLB binary chunk."""
    accessor = glb.accessors[index]
    buffer_view = glb.bufferViews[accessor.bufferView]
    dtype = np.dtype(COMPONENTS[accessor.componentType])
    width = WIDTHS[accessor.type]
    if buffer_view.byteStride not in (None, dtype.itemsize * width):
        raise ValueError("Interleaved vertex data is not supported")
    start = (buffer_view.byteOffset or 0) + (accessor.byteOffset or 0)
    return np.frombuffer(blob, dtype=dtype, count=accessor.count * width, offset=start).reshape(accessor.count, width)


def nearest_on_bones(points, joints, parents, bones):
    """Closest point on the segments of `bones` to each point, and the bone that moves that segment."""
    pairs = [(parent, child) for child, parent in enumerate(parents) if parent in bones and child in bones]
    starts = joints[[parent for parent, _ in pairs]]
    spans = joints[[child for _, child in pairs]] - starts
    t = np.einsum("vsk,sk->vs", points[:, None] - starts[None], spans) / np.maximum((spans * spans).sum(axis=1), 1e-12)
    closest = starts[None] + np.clip(t, 0.0, 1.0)[..., None] * spans[None]
    segment = np.linalg.norm(points[:, None] - closest, axis=2).argmin(axis=1)
    return closest[np.arange(len(points)), segment], np.array([parent for parent, _ in pairs])[segment]


def facing(normals, points, anchors):
    """Cosine between each normal and the direction from its anchor to the point."""
    away = points - anchors
    return (normals * away).sum(axis=1) / np.maximum(np.linalg.norm(away, axis=1), 1e-12)


def give(weights, mass, fallback):
    """Add mass to each row in proportion to its weights, or to the fallback column when the row has none."""
    total = weights.sum(axis=1, keepdims=True)
    share = np.zeros_like(weights)
    share[np.arange(len(weights)), fallback] = 1.0
    share = np.where(total > 1e-6, weights / np.maximum(total, 1e-12), share)
    weights += mass[:, None] * share


def separate_arms(avatar, joints, parents, names):
    """Keep arm skin and body skin apart where the arms touched the body in the photo.

    MIA blends arm weight onto the torso where the arms rested against it, and Pixal3D joins touching surfaces into
    one, so raising an arm pulled a sheet of torso up with it. Arm skin faces away from the arm bones and towards the
    body; body skin faces away from the body bones and towards the arm. Where the two disagree, move the weight to
    the side the surface belongs to, and drop the triangles that still join a committed arm vertex to a committed
    body vertex. Where both face outward, as on the shoulder, MIA's blend stays.
    """
    glb = pygltflib.GLTF2.load_from_bytes(avatar)
    blob = bytearray(glb.binary_blob())
    primitives = [primitive for mesh in glb.meshes for primitive in mesh.primitives]
    if len(primitives) != 1:
        raise ValueError(f"Expected one mesh primitive from Pixal3D, found {len(primitives)}")
    primitive = primitives[0]
    positions = accessor_view(glb, blob, primitive.attributes.POSITION).astype(np.float64)
    indices = accessor_view(glb, blob, primitive.indices).reshape(-1)
    faces = indices.reshape(-1, 3).astype(np.int64)
    bone_ids = accessor_view(glb, blob, primitive.attributes.JOINTS_0)
    bone_weights = accessor_view(glb, blob, primitive.attributes.WEIGHTS_0)
    weights = np.zeros((len(positions), len(names)))
    np.put_along_axis(weights, bone_ids.astype(np.int64), bone_weights.astype(np.float64), axis=1)

    corners = positions[faces]
    face_normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    normals = np.zeros_like(positions)
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)

    joints = np.asarray(joints, dtype=np.float64)
    keep = np.ones(len(faces), dtype=bool)
    for side in ("Left", "Right"):
        arm = [i for i, name in enumerate(names) if name.startswith(side) and ("Arm" in name or "Hand" in name)]
        body = [i for i in range(len(names)) if i not in arm]
        arm_point, arm_bone = nearest_on_bones(positions, joints, parents, set(arm))
        body_point, body_bone = nearest_on_bones(positions, joints, parents, set(body))
        faces_arm = facing(normals, positions, arm_point)
        faces_body = facing(normals, positions, body_point)
        arm_weights, body_weights = weights[:, arm], weights[:, body]
        # Only vertices MIA blended between this arm and the body move. Concave
        # surfaces elsewhere, such as under the chin, also face their own bone.
        blended = (arm_weights.sum(axis=1) > 1 - BRIDGE_MASS) & (body_weights.sum(axis=1) > 1 - BRIDGE_MASS)
        to_body = blended * np.clip(-faces_arm / FACING_BAND, 0, 1) * np.clip(faces_body / FACING_BAND, 0, 1)
        to_arm = blended * np.clip(-faces_body / FACING_BAND, 0, 1) * np.clip(faces_arm / FACING_BAND, 0, 1)
        moved_to_body = arm_weights.sum(axis=1) * to_body
        moved_to_arm = body_weights.sum(axis=1) * to_arm
        arm_weights *= (1 - to_body)[:, None]
        body_weights *= (1 - to_arm)[:, None]
        give(body_weights, moved_to_body, np.searchsorted(body, body_bone))
        give(arm_weights, moved_to_arm, np.searchsorted(arm, arm_bone))
        weights[:, arm], weights[:, body] = arm_weights, body_weights
        arm_mass = arm_weights.sum(axis=1)[faces]
        keep &= ~((arm_mass.max(axis=1) >= BRIDGE_MASS) & (arm_mass.min(axis=1) <= 1 - BRIDGE_MASS))

    order = np.argsort(-weights, axis=1)[:, :4]
    top = np.take_along_axis(weights, order, axis=1)
    bone_ids[:] = order
    bone_weights[:] = top / top.sum(axis=1, keepdims=True)
    kept = faces[keep].reshape(-1)
    indices[: len(kept)] = kept
    index_accessor = glb.accessors[primitive.indices]
    index_accessor.count = len(kept)
    if index_accessor.min is not None:
        index_accessor.min, index_accessor.max = [int(kept.min())], [int(kept.max())]
    glb.set_binary_blob(bytes(blob))
    out = glb.save_to_bytes()
    return b"".join(out) if isinstance(out, (list, tuple)) else out


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
    import rig_glb
    from blendshapes import head_mask_from_weights, load_template

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
    expressions = transfer_expressions(template, vertices, head)
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
    bones = [name.rsplit(":", 1)[-1] for name in names]
    args.output.write_bytes(separate_arms(avatar, predicted["joints"], predicted["parents"], bones))


if __name__ == "__main__":
    main()
