import type { PerformanceSourceType } from "../performance/plan";
import type { Mat4 } from "../worlds/coordinates";
import type { RigPart } from "./actionGraph";
import { QuatMath, type Quat, type Vec3 } from "./pose";

/** `PERFORMANCE_SOURCE_TYPES` member. Do not write `text_prompt`. */
export const GENERATED_MOTION_SOURCE = "generated" satisfies PerformanceSourceType;

export type MotionSource = typeof GENERATED_MOTION_SOURCE;

export type { Mat4 };

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
 * `offset` is in the parent frame (hand-local while held). It is not a world position.
 */
export interface ObjectAttachment {
  objectId: string;
  parentId: string;
  rigPart?: RigPart;
  sourceContactId: string;
  startFrame: number;
  endFrame: number;
  offset?: { translation: Vec3; rotation: Quat };
}

export const translationOf = (matrix: Mat4): Vec3 => [matrix[0][3], matrix[1][3], matrix[2][3]];

/** Row-major `parent * local`. Used for hand world pose × hand-local offset. */
export const multiplyMat4 = (parent: Mat4, local: Mat4): Mat4 =>
  ([0, 1, 2, 3] as const).map((row) =>
    ([0, 1, 2, 3] as const).map((column) =>
      parent[row][0] * local[0][column]
      + parent[row][1] * local[1][column]
      + parent[row][2] * local[2][column]
      + parent[row][3] * local[3][column],
    ),
  ) as unknown as Mat4;

/** Hand world pose × hand-local offset. Both factors are row-major. */
export const composeWorldPose = (parentTranslation: Vec3, parentRotation: Quat, localOffset: Vec3): Mat4 =>
  multiplyMat4(worldTransform(parentTranslation, parentRotation), worldTransform(localOffset));

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
  ] as Mat4;
};
