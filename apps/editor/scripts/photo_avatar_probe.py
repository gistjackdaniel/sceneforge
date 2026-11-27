"""Measure how far a rigged avatar's triangles stretch in test poses, and how far its expressions move the face.

Usage: python photo_avatar_probe.py avatar.glb
Run it with the rig stage's Python. Lengths are reported at the editor's 1.72 m actor height.
"""

import json
import struct
import sys

import numpy as np

EDITOR_HEIGHT = 1.72
TYPES = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMPONENTS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def rotation(axis, degrees):
    axis = np.asarray(axis, dtype=np.float64)
    angle = np.radians(degrees)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * k + (1 - np.cos(angle)) * k @ k


def read_glb(path):
    data = open(path, "rb").read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    blob = data[28 + length:]

    def accessor(index):
        acc = gltf["accessors"][index]
        view = gltf["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(COMPONENTS[acc["componentType"]])
        width = TYPES[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return np.frombuffer(blob, dtype=dtype, count=acc["count"] * width, offset=start).reshape(acc["count"], width)

    return gltf, accessor


def main():
    gltf, accessor = read_glb(sys.argv[1])
    joint_nodes = gltf["skins"][0]["joints"]
    names = [gltf["nodes"][n]["name"].rsplit(":", 1)[-1] for n in joint_nodes]
    where = {node: i for i, node in enumerate(joint_nodes)}
    parent = np.full(len(names), -1)
    for i, node in enumerate(joint_nodes):
        for child in gltf["nodes"][node].get("children", []):
            parent[where[child]] = i
    local = np.array([gltf["nodes"][n].get("translation", [0, 0, 0]) for n in joint_nodes], dtype=np.float64)
    order = sorted(range(len(names)), key=lambda j: depth(parent, j))
    joints = np.zeros_like(local)
    for j in order:
        joints[j] = local[j] + (joints[parent[j]] if parent[j] >= 0 else 0)

    primitive = gltf["meshes"][0]["primitives"][0]
    positions = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
    faces = accessor(primitive["indices"]).reshape(-1, 3).astype(np.int64)
    weights = np.zeros((len(positions), len(names)))
    np.put_along_axis(weights, accessor(primitive["attributes"]["JOINTS_0"]).astype(np.int64),
                      accessor(primitive["attributes"]["WEIGHTS_0"]).astype(np.float64), axis=1)
    to_metres = EDITOR_HEIGHT / np.ptp(positions[:, 1])
    thigh = "UpLeg" if "LeftUpLeg" in names else "Leg"
    poses = {
        "arms up 150°": {"LeftArm": rotation([0, 0, 1], 150), "RightArm": rotation([0, 0, 1], -150)},
        "stride 35°": {f"Left{thigh}": rotation([1, 0, 0], -35), f"Right{thigh}": rotation([1, 0, 0], 35),
                       "LeftArm": rotation([1, 0, 0], 30), "RightArm": rotation([1, 0, 0], -30)},
    }
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    rest = np.linalg.norm(positions[edges[:, 0]] - positions[edges[:, 1]], axis=1)
    report = {"vertices": len(positions), "triangles": len(faces)}
    for label, pose in poses.items():
        turned = [np.eye(3)] * len(names)
        placed = np.zeros_like(joints)
        for j in order:
            own = pose.get(names[j], np.eye(3))
            if parent[j] < 0:
                turned[j], placed[j] = own, joints[j]
            else:
                turned[j] = turned[parent[j]] @ own
                placed[j] = placed[parent[j]] + turned[parent[j]] @ (joints[j] - joints[parent[j]])
        skinned = np.zeros_like(positions)
        for j in np.flatnonzero(weights.any(axis=0)):
            skinned += weights[:, j, None] * ((positions - joints[j]) @ turned[j].T + placed[j])
        length = np.linalg.norm(skinned[edges[:, 0]] - skinned[edges[:, 1]], axis=1)
        ratio = length / np.maximum(rest, 1e-12)
        report[label] = {"edgesOver3x": int((ratio > 3).sum()), "p99Stretch": round(float(np.percentile(ratio, 99)), 2),
                         "longestEdgeM": round(float(length.max() * to_metres), 3)}
    targets = primitive.get("targets", [])
    target_names = gltf["meshes"][0].get("extras", {}).get("targetNames", [])
    for name in ("jawOpen", "eyeBlinkLeft", "mouthSmileLeft"):
        if name in target_names:
            delta = np.linalg.norm(accessor(targets[target_names.index(name)]["POSITION"]), axis=1) * to_metres
            report[f"{name}MaxMm"] = round(float(delta.max() * 1000), 1)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def depth(parent, j):
    return 0 if parent[j] < 0 else 1 + depth(parent, parent[j])


if __name__ == "__main__":
    main()
