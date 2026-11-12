import type { RigPart } from "./contract";
import { addVec3, quatIdentity, quatMul, quatRotate, type Quat, type Vec3 } from "./math";

export interface ProxyJoint {
  name: string;
  parent: string | null;
  translation: Vec3;
  rigPart?: RigPart;
}

/** Proxy skeleton. Local offsets are meters in the parent joint frame. +Z is forward. */
export const PROXY_JOINTS: readonly ProxyJoint[] = [
  { name: "pelvis", parent: null, translation: [0, 0.95, 0], rigPart: "pelvis" },
  { name: "spine", parent: "pelvis", translation: [0, 0.22, 0] },
  { name: "head", parent: "spine", translation: [0, 0.24, 0], rigPart: "head" },
  { name: "left_shoulder", parent: "spine", translation: [-0.18, 0.16, 0] },
  { name: "left_elbow", parent: "left_shoulder", translation: [0, -0.27, 0] },
  { name: "left_wrist", parent: "left_elbow", translation: [0, -0.25, 0], rigPart: "left_hand" },
  { name: "right_shoulder", parent: "spine", translation: [0.18, 0.16, 0] },
  { name: "right_elbow", parent: "right_shoulder", translation: [0, -0.27, 0] },
  { name: "right_wrist", parent: "right_elbow", translation: [0, -0.25, 0], rigPart: "right_hand" },
];

export interface SolvedJoint {
  name: string;
  parent?: string;
  position: Vec3;
  rotation: Quat;
}

/** Forward kinematics. `rootRotation` is the pelvis orientation already converted from XYZ euler. */
export const solveJoints = (
  rootPosition: Vec3,
  rootRotation: Quat,
  local: Readonly<Record<string, Quat>>,
): SolvedJoint[] => {
  const world = new Map<string, { position: Vec3; rotation: Quat }>();
  const joints: SolvedJoint[] = [];
  for (const joint of PROXY_JOINTS) {
    const parent = joint.parent ? world.get(joint.parent) : { position: rootPosition, rotation: rootRotation };
    const origin = parent ?? { position: rootPosition, rotation: rootRotation };
    const localRotation = local[joint.name] ?? quatIdentity();
    const rotation = quatMul(origin.rotation, localRotation);
    const position = addVec3(origin.position, quatRotate(origin.rotation, joint.translation));
    world.set(joint.name, { position, rotation });
    joints.push({ name: joint.name, parent: joint.parent ?? undefined, position, rotation });
  }
  return joints;
};
