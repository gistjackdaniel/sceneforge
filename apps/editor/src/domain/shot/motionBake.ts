import type { Mat4 } from "../worlds/coordinates";
import { eulerToQuaternion, quaternionToEuler } from "./eulerAdapter";
import type { Motion, ObjectPoseKey, Quat, Vec3 } from "./types";

/**
 * Schema v0 bake tolerance. See `docs/phase0/motion-bake-v0.md`.
 * Position matches the Phase 0 contact tolerance (5 mm). Rotation is 2 degrees.
 */
export const MOTION_BAKE_TOLERANCE = {
  positionMeters: 0.005,
  rotationRadians: (2 * Math.PI) / 180,
  scale: 1e-4,
} as const;

export type MotionBakeTolerance = typeof MOTION_BAKE_TOLERANCE;

export type DenseObjectFrame = {
  /** Integer frame on `Shot.time`. Seconds are `t / Shot.time.fps`. */
  t: number;
  /** Row-major world transform of the object, the Backbone `T_world_obj`. */
  T_world_obj: Mat4;
};

type Sample = {
  frame: number;
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
};

const mix = (start: number, end: number, amount: number) => start + (end - start) * amount;

const mixVec = (start: Vec3, end: Vec3, amount: number): Vec3 => [
  mix(start[0], end[0], amount),
  mix(start[1], end[1], amount),
  mix(start[2], end[2], amount),
];

const columnLength = (matrix: Mat4, column: 0 | 1 | 2): number =>
  Math.hypot(matrix[0][column], matrix[1][column], matrix[2][column]);

const quatFromMatrix = (m00: number, m01: number, m02: number, m10: number, m11: number, m12: number, m20: number, m21: number, m22: number): Quat => {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return [(m21 - m12) / scale, (m02 - m20) / scale, (m10 - m01) / scale, 0.25 * scale];
  }
  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * scale, (m01 + m10) / scale, (m02 + m20) / scale, (m21 - m12) / scale];
  }
  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / scale, 0.25 * scale, (m12 + m21) / scale, (m02 - m20) / scale];
  }
  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / scale, (m12 + m21) / scale, 0.25 * scale, (m10 - m01) / scale];
};

/** Decompose a row-major TRS matrix into the shot pose. Rotation is stored as XYZ euler. */
export const shotPoseFromWorldMatrix = (matrix: Mat4): { position: Vec3; rotationEuler: Vec3; scale: Vec3 } => {
  const scales: [number, number, number] = [columnLength(matrix, 0), columnLength(matrix, 1), columnLength(matrix, 2)];
  const safe = (length: number) => (length > 1e-8 ? length : 1);
  let r00 = matrix[0][0] / safe(scales[0]);
  let r10 = matrix[1][0] / safe(scales[0]);
  let r20 = matrix[2][0] / safe(scales[0]);
  const r01 = matrix[0][1] / safe(scales[1]);
  const r11 = matrix[1][1] / safe(scales[1]);
  const r21 = matrix[2][1] / safe(scales[1]);
  const r02 = matrix[0][2] / safe(scales[2]);
  const r12 = matrix[1][2] / safe(scales[2]);
  const r22 = matrix[2][2] / safe(scales[2]);
  const determinant = r00 * (r11 * r22 - r21 * r12) - r01 * (r10 * r22 - r20 * r12) + r02 * (r10 * r21 - r20 * r11);
  if (determinant < 0) {
    scales[0] = -scales[0];
    r00 = -r00;
    r10 = -r10;
    r20 = -r20;
  }
  const rotation = quatFromMatrix(r00, r01, r02, r10, r11, r12, r20, r21, r22);
  return {
    position: [matrix[0][3], matrix[1][3], matrix[2][3]],
    rotationEuler: quaternionToEuler(rotation),
    scale: scales,
  };
};

/** Inverse of `shotPoseFromWorldMatrix` for proper rotations. Used to build `T_world_obj` in tests. */
export const worldMatrixFromShotPose = (pose: { position: Vec3; rotationEuler: Vec3; scale: Vec3 }): Mat4 => {
  const [x, y, z, w] = eulerToQuaternion(pose.rotationEuler);
  const [sx, sy, sz] = pose.scale;
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
    [(1 - 2 * (yy + zz)) * sx, 2 * (xy - wz) * sy, 2 * (xz + wy) * sz, pose.position[0]],
    [2 * (xy + wz) * sx, (1 - 2 * (xx + zz)) * sy, 2 * (yz - wx) * sz, pose.position[1]],
    [2 * (xz - wy) * sx, 2 * (yz + wx) * sy, (1 - 2 * (xx + yy)) * sz, pose.position[2]],
    [0, 0, 0, 1],
  ];
};

const quatAngle = (left: Quat, right: Quat): number => {
  const dot = Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3]);
  return 2 * Math.acos(Math.min(1, dot));
};

const playbackError = (sample: Sample, left: Sample, right: Sample) => {
  const span = right.frame - left.frame;
  const amount = span === 0 ? 0 : (sample.frame - left.frame) / span;
  const position = mixVec(left.position, right.position, amount);
  const euler = mixVec(left.rotationEuler, right.rotationEuler, amount);
  const scale = mixVec(left.scale, right.scale, amount);
  return {
    position: Math.hypot(position[0] - sample.position[0], position[1] - sample.position[1], position[2] - sample.position[2]),
    rotation: quatAngle(eulerToQuaternion(euler), eulerToQuaternion(sample.rotationEuler)),
    scale: Math.max(
      Math.abs(scale[0] - sample.scale[0]),
      Math.abs(scale[1] - sample.scale[1]),
      Math.abs(scale[2] - sample.scale[2]),
    ),
  };
};

const scoreOf = (
  error: { position: number; rotation: number; scale: number },
  tolerance: MotionBakeTolerance,
): number => Math.max(
  error.position / tolerance.positionMeters,
  error.rotation / tolerance.rotationRadians,
  error.scale / tolerance.scale,
);

/**
 * Douglas–Peucker over integer frames.
 * A segment is kept as its endpoints when linear XYZ-euler playback stays inside `tolerance`.
 * The worst interior frame, lowest index on a tie, is the split.
 */
const keepFrames = (samples: Sample[], tolerance: MotionBakeTolerance): number[] => {
  const keep = new Set<number>();
  const visit = (lo: number, hi: number) => {
    keep.add(samples[lo]!.frame);
    keep.add(samples[hi]!.frame);
    if (hi <= lo + 1) return;
    let worst = -1;
    let worstScore = 1;
    for (let index = lo + 1; index < hi; index += 1) {
      const score = scoreOf(playbackError(samples[index]!, samples[lo]!, samples[hi]!), tolerance);
      if (score > worstScore) {
        worstScore = score;
        worst = index;
      }
    }
    if (worst >= 0) {
      visit(lo, worst);
      visit(worst, hi);
    }
  };
  visit(0, samples.length - 1);
  return [...keep].sort((left, right) => left - right);
};

/**
 * Bake a dense `T_world_obj` stream into sparse shot motion keys.
 *
 * `t` is an integer frame on `shot.time` (`Shot.time.fps` is the only clock; this function does not store fps).
 * Non-integers and frames outside `[0, durationFrames)` are dropped. A repeated frame keeps the last sample.
 * Keys store `rotationEuler` in `SHOT_EULER_ORDER`. The contract boundary reads that euler as a quaternion.
 * Playback assumed by the selector is linear, the same as `Motion.interpolation: "linear"`.
 * No I/O. Equal inputs return equal keys.
 */
export const bakeDenseObjectMotion = (
  shot: { time: { fps: number; durationFrames: number } },
  frames: readonly DenseObjectFrame[],
  tolerance: MotionBakeTolerance = MOTION_BAKE_TOLERANCE,
): Motion => {
  if (!(shot.time.fps > 0) || !Number.isFinite(shot.time.fps)) {
    throw new Error("Shot.time.fps must be positive.");
  }
  if (!Number.isInteger(shot.time.durationFrames) || shot.time.durationFrames < 1) {
    throw new Error("Shot.time.durationFrames must be a positive integer.");
  }
  const byFrame = new Map<number, DenseObjectFrame>();
  for (const frame of frames) {
    if (!Number.isInteger(frame.t) || frame.t < 0 || frame.t >= shot.time.durationFrames) continue;
    byFrame.set(frame.t, frame);
  }
  const samples = [...byFrame.entries()]
    .sort(([left], [right]) => left - right)
    .map(([frame, sample]) => ({ frame, ...shotPoseFromWorldMatrix(sample.T_world_obj) }));
  if (samples.length === 0) return { channel: "unset" };
  const kept = new Set(samples.length === 1 ? [samples[0]!.frame] : keepFrames(samples, tolerance));
  const keys = samples.filter((sample) => kept.has(sample.frame)).map((sample) => ({
    frame: sample.frame,
    position: sample.position,
    rotationEuler: sample.rotationEuler,
    scale: sample.scale,
  }));
  const packed = keys[0];
  if (!packed) return { channel: "unset" };
  return {
    channel: "explicit",
    interpolation: "linear",
    keys: keys as [ObjectPoseKey, ...ObjectPoseKey[]],
    provenance: { kind: "keyed" },
  };
};
