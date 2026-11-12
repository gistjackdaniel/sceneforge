import type { RigPart } from "./actionGraph";
import { QuatMath, type Quat, type Vec3 } from "./pose";

/**
 * Pose/motion source for this lane's output.
 *
 * TODO(#36 머지 후 교체): `generated` is already on `PERFORMANCE_SOURCE_TYPES`
 * in `domain/performance/plan.ts` on that branch. This base still omits it, and
 * `normalizeSource` rewrites an unknown type to `text_prompt`. Keep this constant
 * until that enum is on this base. Do not write `text_prompt`.
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

/**
 * World schema v0 bakes dense `T_world_obj` with `bakeDenseObjectMotion`
 * (`domain/shot/motionBake.ts`: 5 mm, 2°, scale 1e-4).
 *
 * TODO(#36 머지 후 교체): call that function. This lane does not bake.
 */
export interface ObjectTransformBake {
  bake(stream: ObjectPoseStream): readonly unknown[];
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
