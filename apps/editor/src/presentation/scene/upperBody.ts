import { Quaternion, Vector3 } from "three";
import type { SomaRig } from "./somaRetarget";

type Vec3 = [number, number, number];
/** SOMA bones the webcam drives, each aimed from its joint toward the next joint down the chain. */
export type UpperBodyJoint = "Chest" | "LeftArm" | "LeftForeArm" | "RightArm" | "RightForeArm";
/** Unit directions in actor space: +X is the actor's left, +Y up, +Z the way it faces. */
export type UpperBodyAims = Partial<Record<UpperBodyJoint, Vec3>>;
export type PoseLandmark = { x: number; y: number; z: number; visibility?: number };

// MediaPipe Pose landmark indices, named for the person's own left and right.
const SHOULDER = { Left: 11, Right: 12 };
const ELBOW = { Left: 13, Right: 14 };
const WRIST = { Left: 15, Right: 16 };
const HIP = { Left: 23, Right: 24 };
const VISIBLE = 0.5;

/** MediaPipe world landmarks have y down and z toward the camera; the person faces the camera, so the actor faces +Z. */
const toActor = ({ x, y, z }: PoseLandmark): Vec3 => [x, -y, -z];
const between = (from: Vec3, to: Vec3): Vec3 | undefined => {
  const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(...direction);
  return length > 1e-6 ? [direction[0] / length, direction[1] / length, direction[2] / length] : undefined;
};
const middle = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Bone directions from one person's world landmarks. Bones whose joints the camera cannot see are left out. */
export const readUpperBodyAims = (landmarks: readonly PoseLandmark[]): UpperBodyAims => {
  const seen = (index: number) => (landmarks[index]?.visibility ?? 1) >= VISIBLE;
  const at = (index: number) => toActor(landmarks[index]);
  const aims: UpperBodyAims = {};
  for (const side of ["Left", "Right"] as const) {
    if (seen(SHOULDER[side]) && seen(ELBOW[side])) aims[`${side}Arm`] = between(at(SHOULDER[side]), at(ELBOW[side]));
    if (seen(ELBOW[side]) && seen(WRIST[side])) aims[`${side}ForeArm`] = between(at(ELBOW[side]), at(WRIST[side]));
  }
  if ([SHOULDER.Left, SHOULDER.Right, HIP.Left, HIP.Right].every(seen)) {
    aims.Chest = between(middle(at(HIP.Left), at(HIP.Right)), middle(at(SHOULDER.Left), at(SHOULDER.Right)));
  }
  for (const joint of Object.keys(aims) as UpperBodyJoint[]) if (!aims[joint]) delete aims[joint];
  return aims;
};

/** Ease toward the new directions so detector jitter does not shake the actor. Bones the camera lost are dropped. */
export const smoothAims = (previous: UpperBodyAims | undefined, next: UpperBodyAims, keep = 0.5): UpperBodyAims => {
  const smoothed: UpperBodyAims = {};
  for (const [joint, direction] of Object.entries(next) as Array<[UpperBodyJoint, Vec3]>) {
    const before = previous?.[joint];
    const blended = before ? direction.map((value, axis) => before[axis] * keep + value * (1 - keep)) as Vec3 : direction;
    const length = Math.hypot(...blended);
    smoothed[joint] = length > 1e-6 ? [blended[0] / length, blended[1] / length, blended[2] / length] : direction;
  }
  return smoothed;
};

const swing = new Quaternion();
const world = new Quaternion();
const parent = new Quaternion();
const current = new Vector3();
const target = new Vector3();
const actor = new Quaternion();

/** Turn each aimed bone, parents first, so its segment points along the webcam direction. Other bones keep their pose. */
export const aimUpperBody = (rig: SomaRig, aims: UpperBodyAims): void => {
  rig.root.getWorldQuaternion(actor);
  for (const { sourceName, bone, segment } of rig.joints) {
    const aim = aims[sourceName as UpperBodyJoint];
    if (!aim || !segment || !bone.parent) continue;
    bone.getWorldQuaternion(world);
    current.copy(segment.localDirection).applyQuaternion(world);
    target.set(...aim).applyQuaternion(actor);
    world.premultiply(swing.setFromUnitVectors(current, target));
    bone.parent.getWorldQuaternion(parent).invert();
    bone.quaternion.copy(world.premultiply(parent));
    bone.updateWorldMatrix(false, true);
  }
};
