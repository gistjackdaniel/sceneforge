import type { RigPart } from "./actionGraph";
import { QuatMath, type Quat, type Vec3 } from "./pose";

/**
 * Pose/motion source for this lane's output.
 *
 * TODO(world): `PERFORMANCE_SOURCE_TYPES` is still
 * `text_prompt | live_action | motion_capture | key_animation_2d`.
 * `normalizeSource` rewrites an unknown type to `text_prompt`.
 * Keep this constant until `generated` is on that enum. Do not write `text_prompt`.
 */
export const GENERATED_MOTION_SOURCE = "generated" as const;

export type MotionSource = typeof GENERATED_MOTION_SOURCE;

/** Row-major 4×4, the same shape as `backboneObjectPoseSchema.frames[].T_world_obj`. */
export type Mat4 = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

export interface WorldObjectFrame {
  /** Integer frame index on `Shot.time.fps`. The shot clock is `[0, durationFrames)`. */
  t: number;
  T_world_obj: Mat4;
}

/** Dense object motion. One matrix per shot frame. Not a sparse key bake. */
export interface ObjectPoseStream {
  objectId: string;
  subjectId?: string;
  source: MotionSource;
  frames: readonly WorldObjectFrame[];
}

/**
 * Parent of a dynamic object over a half-open frame range `[startFrame, endFrame)`.
 * `rigPart` is set only when the parent is an actor, and it is a `rigPartSchema` value.
 */
export interface ObjectAttachment {
  objectId: string;
  parentId: string;
  rigPart?: RigPart;
  sourceContactId: string;
  startFrame: number;
  endFrame: number;
}

/**
 * World schema v0 decides how dense `T_world_obj` becomes sparse shot keys.
 * This lane does not bake. Callers may supply an implementation later.
 */
export interface ObjectTransformBake {
  bake(stream: ObjectPoseStream): readonly unknown[];
}

export const translationOf = (matrix: Mat4): Vec3 => [matrix[0][3], matrix[1][3], matrix[2][3]];

/** Rigid transform. Rotation is the joint quaternion; translation is world meters. */
export const worldTransform = (translation: Vec3, rotation: Quat = QuatMath.identity()): Mat4 => {
  const [x, y, z, w] = QuatMath.normalize(rotation);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), translation[0]],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), translation[1]],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), translation[2]],
    [0, 0, 0, 1],
  ];
};
