"""Rig a Pixal3D GLB with Kimodo's SOMA-77 skeleton and transfer the ICT-FaceKit expression set locally."""

import argparse
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pygltflib
import scipy.sparse as sp
import trimesh
from scipy.sparse.linalg import spsolve
from scipy.spatial import cKDTree

SOMA_SKIN = Path(__file__).with_name("assets") / "soma_skin_standard.npz"
# three.ws blendshapes.py falloff: a fraction of head height, cut off after three sigmas.
FALLOFF_SIGMA_RATIO = 0.08
FALLOFF_CUTOFF_SIGMAS = 3.0
COMPONENTS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTHS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}

# Each SOMA bone turns so that its SOMA child vectors point along the matching Make-It-Animatable vectors.
AIMS = {
    "Hips": ([("Hips", "Chest"), ("Hips", "LeftLeg"), ("Hips", "RightLeg")],
             [("Hips", "Spine"), ("Hips", "LeftUpLeg"), ("Hips", "RightUpLeg")]),
    "Chest": ([("Chest", "Neck1"), ("Chest", "LeftShoulder"), ("Chest", "RightShoulder")],
              [("Spine2", "Neck"), ("Spine2", "LeftShoulder"), ("Spine2", "RightShoulder")]),
    "Neck1": ([("Neck1", "Head")], [("Neck", "Head")]),
    "Head": ([("Neck1", "Head")], [("Neck", "Head")]),
}
# SOMA joints that sit exactly on the Make-It-Animatable joint of the same anatomy.
COUNTERPART = {"Hips": "Hips", "Neck1": "Neck", "Head": "Head"}
for _side in ("Left", "Right"):
    for _soma, _mia, _end_soma, _end_mia in (
        ("Shoulder", "Shoulder", "Arm", "Arm"), ("Arm", "Arm", "ForeArm", "ForeArm"),
        ("ForeArm", "ForeArm", "Hand", "Hand"), ("Hand", "Hand", "HandMiddle1", "HandMiddle1"),
        ("Leg", "UpLeg", "Shin", "Leg"), ("Shin", "Leg", "Foot", "Foot"), ("Foot", "Foot", "ToeBase", "ToeBase"),
    ):
        AIMS[_side + _soma] = ([(_side + _soma, _side + _end_soma)], [(_side + _mia, _side + _end_mia)])
        COUNTERPART[_side + _soma] = _side + _mia
        COUNTERPART[_side + _end_soma] = _side + _end_mia
# Pixal3D hands and faces have no separate fingers, jaw, or eyes, so those bones move with the hand or head.
RIGID = ("Thumb", "Index", "Middle", "Ring", "Pinky", "Jaw", "Eye")

# Each body part, the SOMA bones it owns, its parent part, and the joint they share.
PARTS = {
    "head": (("Neck1", "Neck2", "Head", "HeadEnd", "Jaw", "LeftEye", "RightEye"), "torso", "Neck1"),
    "torso": (("Hips", "Spine1", "Spine2", "Chest", "LeftShoulder", "RightShoulder"), None, None),
}
for _side in ("Left", "Right"):
    PARTS.update({
        f"{_side}Arm": ((f"{_side}Arm",), "torso", f"{_side}Arm"),
        f"{_side}ForeArm": ((f"{_side}ForeArm",), f"{_side}Arm", f"{_side}ForeArm"),
        f"{_side}Hand": ((f"{_side}Hand",), f"{_side}ForeArm", f"{_side}Hand"),
        f"{_side}Thigh": ((f"{_side}Leg",), "torso", f"{_side}Leg"),
        f"{_side}Shin": ((f"{_side}Shin",), f"{_side}Thigh", f"{_side}Shin"),
        f"{_side}Foot": ((f"{_side}Foot", f"{_side}ToeBase", f"{_side}ToeEnd"), f"{_side}Shin", f"{_side}Foot"),
    })
# A part blends with its parent only within this fraction of the part's length from the joint they share.
JOINT_REACH = 0.45
# Weight averaging passes over the mesh after the parts are separated.
SMOOTHING_ROUNDS = 15


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


def rotation_between(source, target):
    """Rotation taking source vectors onto target directions: the shortest arc for one vector, Kabsch for several."""
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if len(source) > 1:
        a = source / np.linalg.norm(source, axis=1, keepdims=True)
        b = target / np.linalg.norm(target, axis=1, keepdims=True)
        u, _, vt = np.linalg.svd(b.T @ a)
        return u @ np.diag([1.0, 1.0, np.sign(np.linalg.det(u @ vt))]) @ vt
    a, b = source[0] / np.linalg.norm(source[0]), target[0] / np.linalg.norm(target[0])
    axis, cosine = np.cross(a, b), float(a @ b)
    if cosine < -0.999999:
        axis = np.cross(a, [1.0, 0.0, 0.0] if abs(a[0]) < 0.9 else [0.0, 1.0, 0.0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + k + k @ k / (1 + cosine)


def fit_soma(soma, target, crown):
    """Pose and stretch the SOMA skeleton onto the Make-It-Animatable joints of the reconstructed person."""
    names = [str(name) for name in soma["rig_joint_names"]]
    index = {name: i for i, name in enumerate(names)}
    bind = soma["bind_rig_transform"][:, :3, 3].astype(np.float64)
    parents = np.full(len(names), -1)
    for parent, child in soma["rig_joint_connections"]:
        parents[child] = parent
    rotations = [None] * len(names)
    for name, (soma_pairs, mia_pairs) in AIMS.items():
        rotations[index[name]] = rotation_between([bind[index[b]] - bind[index[a]] for a, b in soma_pairs],
                                                  [target[b] - target[a] for a, b in mia_pairs])

    def depth(j):
        return 0 if parents[j] < 0 else 1 + depth(parents[j])

    order = sorted(range(len(names)), key=depth)
    scale = (crown - target["LeftFoot"][1]) / (bind[index["HeadEnd"], 1] - bind[index["LeftFoot"], 1])
    posed = np.zeros_like(bind)
    for j in order:
        if rotations[j] is None:
            rotations[j] = rotations[parents[j]] if parents[j] >= 0 else np.eye(3)
        if names[j] in COUNTERPART:
            posed[j] = target[COUNTERPART[names[j]]]
        else:
            posed[j] = posed[parents[j]] + scale * rotations[parents[j]] @ (bind[j] - bind[parents[j]])
    scales = np.full(len(names), scale)
    for name, (soma_pairs, _) in AIMS.items():
        if len(soma_pairs) == 1:
            a, b = index[soma_pairs[0][0]], index[soma_pairs[0][1]]
            scales[index[name]] = np.linalg.norm(posed[b] - posed[a]) / np.linalg.norm(bind[b] - bind[a])
    # Make-It-Animatable has no head-top joint, so the head scales to the reconstructed crown.
    head = index["Head"]
    scales[head] = (crown - posed[head, 1]) / (bind[index["HeadEnd"], 1] - bind[head, 1])
    for side in ("Left", "Right"):
        scales[index[f"{side}Hand"]] = scales[index[f"{side}ForeArm"]]
    for j in order:
        if names[j] not in AIMS and parents[j] >= 0:
            scales[j] = scales[parents[j]]
    return names, parents, bind, posed, np.array(rotations), scales


def pose_soma(soma, bind, posed, rotations, scales):
    """SOMA body vertices under the fitted pose, by linear blend skinning with per-bone scale."""
    rest = soma["bind_vertices"].astype(np.float64)
    out = np.zeros_like(rest)
    for k in range(soma["lbs_indices"].shape[1]):
        j = soma["lbs_indices"][:, k]
        local = scales[j][:, None] * (rest - bind[j])
        out += soma["lbs_weights"][:, k, None] * (np.einsum("vij,vj->vi", rotations[j], local) + posed[j])
    return out


def soma_weights(soma, names):
    """Dense SOMA skin weights with fingers folded into the hands and the jaw and eyes into the head."""
    weights = np.zeros((len(soma["bind_vertices"]), len(names)))
    np.put_along_axis(weights, soma["lbs_indices"].astype(np.int64), soma["lbs_weights"].astype(np.float64), axis=1)
    for j, name in enumerate(names):
        if any(key in name for key in RIGID):
            home = "Head" if "Jaw" in name or "Eye" in name else ("LeftHand" if name.startswith("Left") else "RightHand")
            weights[:, names.index(home)] += weights[:, j]
            weights[:, j] = 0.0
    return weights


def transfer_weights(body, weights, vertices, normals, faces, reach):
    """Give each vertex the SOMA weights of the body surface beneath it, then inpaint the vertices with none.

    The nearest SOMA surface is wrong where the photo pressed parts together: a hip vertex under a resting hand is
    closest to the SOMA hand. A ray going into the reconstruction from that vertex meets the SOMA hip instead. Where
    SOMA is fatter than the reconstruction the vertex lies inside SOMA, so an outward ray finds the surface.
    """
    found = []
    for direction, penalty in ((-1.0, 0.0), (1.0, 0.5 * reach)):
        hits, rays, triangles = body.ray.intersects_location(vertices, direction * normals, multiple_hits=True)
        distance = np.linalg.norm(hits - vertices[rays], axis=1)
        entered = (np.einsum("ij,ij->i", body.face_normals[triangles], normals[rays]) > 0.5) & (distance < reach)
        found.append((hits[entered], rays[entered], triangles[entered], distance[entered] + penalty))
    hits, rays, triangles, distance = (np.concatenate(parts) for parts in zip(*found))
    order = np.lexsort((distance, rays))
    first = order[np.r_[True, rays[order][1:] != rays[order][:-1]]]
    barycentric = trimesh.triangles.points_to_barycentric(body.triangles[triangles[first]], hits[first])
    transferred = np.zeros((len(vertices), weights.shape[1]))
    transferred[rays[first]] = np.einsum("mk,mkj->mj", barycentric, weights[body.faces[triangles[first]]])

    # Inpaint on the surface with UV-seam copies welded, pulled weakly toward the nearest SOMA vertex so that
    # pieces with no transferred vertex still get weights.
    _, weld = np.unique(np.round(vertices, 6), axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    count = weld.max() + 1
    edges = weld[np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])]
    adjacency = sp.coo_matrix((np.ones(2 * len(edges)), (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])),
                              shape=(count, count)).tocsr()
    adjacency.data[:] = 1.0
    laplacian = sp.diags(np.asarray(adjacency.sum(axis=1)).ravel()) - adjacency
    known = np.zeros(count, dtype=bool)
    known[weld[rays[first]]] = True
    welded = np.zeros((count, weights.shape[1]))
    welded[weld[rays[first]]] = transferred[rays[first]]
    fallback = np.zeros_like(welded)
    fallback[weld] = weights[cKDTree(body.vertices).query(vertices)[1]]
    unknown = ~known
    if unknown.any():
        pull = 1e-3
        system = (laplacian[unknown][:, unknown] + pull * sp.identity(int(unknown.sum()))).tocsc()
        solved = spsolve(system, pull * fallback[unknown] - laplacian[unknown][:, known] @ welded[known])
        welded[unknown] = np.clip(np.asarray(solved).reshape(int(unknown.sum()), -1), 0.0, None)
    result = welded[weld]
    return result / np.maximum(result.sum(axis=1, keepdims=True), 1e-12)


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


def part_of(name):
    for part, (bones, _, _) in PARTS.items():
        if name in bones or (part.endswith("Hand") and name.startswith(part)):
            return part
    raise ValueError(f"No body part for bone {name}")


def separate_parts(avatar, joints, names):
    """Keep the body parts apart where the photo pressed them together.

    Pixal3D joins touching surfaces into one, so a hand resting on a hip or an arm against the torso is a single
    sheet of triangles, and raising the arm stretched that sheet. Label each vertex with the part that holds most of
    its weight. A vertex keeps weight on a neighbouring part only near the joint the two share, and a triangle that
    joins parts which are not neighbours, or neighbours away from that joint, is dropped.
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

    parts = list(PARTS)
    index = {name: i for i, name in enumerate(names)}
    owner = np.array([parts.index(part_of(name)) for name in names])
    label = np.stack([weights[:, owner == k].sum(axis=1) for k in range(len(parts))], axis=1).argmax(axis=1)
    parent = np.array([parts.index(p) if p else -1 for _, p, _ in PARTS.values()])
    joint = np.array([index[j] if j else -1 for _, _, j in PARTS.values()])
    reach = np.zeros(len(parts))
    for k in range(len(parts)):
        if joint[k] < 0:
            continue
        children = [c for c in range(len(parts)) if parent[c] == k]
        if children:
            length = max(np.linalg.norm(joints[joint[c]] - joints[joint[k]]) for c in children)
        else:
            own = [i for i in range(len(names)) if owner[i] == k and i != joint[k]]
            length = 2 * np.linalg.norm(joints[own].mean(axis=0) - joints[joint[k]])
        reach[k] = JOINT_REACH * length

    def near_joint(vertices, part):
        return np.linalg.norm(positions[vertices] - joints[joint[part]], axis=1) <= reach[part]

    every = np.arange(len(positions))
    allowed = np.zeros((len(positions), len(parts)), dtype=bool)
    allowed[every, label] = True
    for k in range(len(parts)):
        if parent[k] >= 0:
            close = near_joint(every, k)
            allowed[(label == k) & close, parent[k]] = True
            allowed[(label == parent[k]) & close, k] = True
    weights *= allowed[:, owner]
    empty = weights.sum(axis=1) <= 1e-9
    first_bone = np.array([index[PARTS[p][0][0]] for p in parts])
    weights[empty, first_bone[label[empty]]] = 1.0

    keep = np.ones(len(faces), dtype=bool)
    for corner in range(3):
        u, v = label[faces[:, corner]], label[faces[:, corner - 1]]
        child = np.where(parent[u] == v, u, np.where(parent[v] == u, v, -1))
        legit = child >= 0
        legit[legit] &= near_joint(faces[legit, corner], child[legit]) & near_joint(faces[legit, corner - 1], child[legit])
        keep &= (u == v) | legit

    # The rays hand neighbouring vertices weights from different SOMA surfaces, such as a shirt hem over the thigh,
    # and the jump tore the hem when a leg swung. Average over the kept triangles, welded across UV seams, within
    # each vertex's allowed parts.
    _, weld = np.unique(np.round(positions, 6), axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    count = weld.max() + 1
    kept_faces = weld[faces[keep]]
    edges = np.concatenate([kept_faces[:, [0, 1]], kept_faces[:, [1, 2]], kept_faces[:, [2, 0]]])
    neighbours = sp.coo_matrix((np.ones(2 * len(edges)), (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])),
                               shape=(count, count)).tocsr()
    neighbours.data[:] = 1.0
    neighbours = neighbours + sp.identity(count)
    average = sp.diags(1.0 / np.asarray(neighbours.sum(axis=1)).ravel()) @ neighbours
    may = np.zeros((count, len(names)), dtype=bool)
    np.logical_or.at(may, weld, allowed[:, owner])
    welded = np.zeros((count, len(names)))
    np.add.at(welded, weld, weights)
    for _ in range(SMOOTHING_ROUNDS):
        welded /= np.maximum(welded.sum(axis=1, keepdims=True), 1e-12)
        welded = (average @ welded) * may
    weights = welded[weld] * allowed[:, owner]
    empty = weights.sum(axis=1) <= 1e-9
    weights[empty, first_bone[label[empty]]] = 1.0

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

    # Make-It-Animatable reads the same welded mesh, so its joints live in this space.
    mesh = trimesh.load(args.mesh, force="mesh")
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    engine_mia.init()
    predicted = engine_mia.predict(str(args.mesh))
    target = {name.rsplit(":", 1)[-1]: joint for name, joint in zip(predicted["names"], predicted["joints"])}

    soma = np.load(SOMA_SKIN)
    names, parents, bind, posed, rotations, scales = fit_soma(soma, target, vertices[:, 1].max())
    body = trimesh.Trimesh(pose_soma(soma, bind, posed, rotations, scales), soma["faces"], process=False)
    weights = transfer_weights(body, soma_weights(soma, names), vertices, np.asarray(mesh.vertex_normals),
                               faces, 0.06 * np.ptp(vertices[:, 1]))

    expressions = transfer_expressions(template, vertices, head_mask_from_weights(weights, names))
    deltas = expressions["deltas"]
    for name in ("eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight"):
        shape = deltas[expressions["names"].index(name)]
        if not np.isfinite(shape).all() or not np.any(np.abs(shape) > 1e-7):
            raise ValueError(f"The reconstructed head could not be rigged for {name}")

    avatar = rig_glb.build_rigged_glb(
        mesh_bytes, SimpleNamespace(vertices=vertices), posed, parents, weights,
        blendshape_data=expressions, joint_names=names,
    )
    args.output.write_bytes(separate_parts(avatar, posed, names))


if __name__ == "__main__":
    main()
