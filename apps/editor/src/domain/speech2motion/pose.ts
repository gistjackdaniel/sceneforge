import type { RigPart } from "./actionGraph";

/** xyzw. Shot-record object keys stay Euler; this quaternion is the model joint frame. */
export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

export const SMPLX_JOINT_COUNT = 55;

export const SMPLX_JOINT_NAMES = [
  "pelvis",
  "left_hip",
  "right_hip",
  "spine1",
  "left_knee",
  "right_knee",
  "spine2",
  "left_ankle",
  "right_ankle",
  "spine3",
  "left_foot",
  "right_foot",
  "neck",
  "left_collar",
  "right_collar",
  "head",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "jaw",
  "left_eye",
  "right_eye",
  "left_index1",
  "left_index2",
  "left_index3",
  "left_middle1",
  "left_middle2",
  "left_middle3",
  "left_pinky1",
  "left_pinky2",
  "left_pinky3",
  "left_ring1",
  "left_ring2",
  "left_ring3",
  "left_thumb1",
  "left_thumb2",
  "left_thumb3",
  "right_index1",
  "right_index2",
  "right_index3",
  "right_middle1",
  "right_middle2",
  "right_middle3",
  "right_pinky1",
  "right_pinky2",
  "right_pinky3",
  "right_ring1",
  "right_ring2",
  "right_ring3",
  "right_thumb1",
  "right_thumb2",
  "right_thumb3",
] as const;

export type SmplxJointName = (typeof SMPLX_JOINT_NAMES)[number];

type JointCount = (typeof SMPLX_JOINT_NAMES)["length"] extends 55 ? true : never;
const jointCountCheck: JointCount = true;
void jointCountCheck;

export const jointIndex = (name: SmplxJointName): number => SMPLX_JOINT_NAMES.indexOf(name);

const PELVIS = jointIndex("pelvis");
const LEFT_HIP = jointIndex("left_hip");
const RIGHT_HIP = jointIndex("right_hip");
const LEFT_KNEE = jointIndex("left_knee");
const RIGHT_KNEE = jointIndex("right_knee");
const LEFT_ANKLE = jointIndex("left_ankle");
const RIGHT_ANKLE = jointIndex("right_ankle");
const LEFT_SHOULDER = jointIndex("left_shoulder");
const RIGHT_SHOULDER = jointIndex("right_shoulder");
const LEFT_ELBOW = jointIndex("left_elbow");
const RIGHT_ELBOW = jointIndex("right_elbow");
const LEFT_WRIST = jointIndex("left_wrist");
const RIGHT_WRIST = jointIndex("right_wrist");

/** Parent joint, or -1 for the pelvis. Hand joints hang off the wrist. */
const PARENTS: readonly number[] = [
  -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 15, 15, 15,
  ...Array.from({ length: 15 }, () => LEFT_WRIST),
  ...Array.from({ length: 15 }, () => RIGHT_WRIST),
];

const v = (x: number, y: number, z: number): Vec3 => [x, y, z];

const handOffsets = (side: 1 | -1, wristY: number, wristZ: number): Vec3[] => {
  const wristX = side * 0.71;
  const spreads = [0.03, 0.01, -0.01, -0.03];
  const fingers = spreads.flatMap((spread) =>
    [1, 2, 3].map((step) => v(wristX + side * 0.03 * step, wristY + spread, wristZ + 0.01 * step)),
  );
  const thumb = [1, 2, 3].map((step) => v(wristX + side * 0.025 * step, wristY - 0.02, wristZ - 0.02 * step));
  return [...fingers, ...thumb];
};

/** Pelvis-relative rest offsets, meters, Y-up, T-pose. Upper arm 0.28, forearm 0.25. */
const REST_OFFSET: readonly Vec3[] = [
  v(0, 0, 0),
  v(-0.09, -0.09, 0),
  v(0.09, -0.09, 0),
  v(0, 0.12, 0),
  v(-0.09, -0.48, 0.02),
  v(0.09, -0.48, 0.02),
  v(0, 0.26, 0),
  v(-0.09, -0.88, 0),
  v(0.09, -0.88, 0),
  v(0, 0.4, 0),
  v(-0.09, -0.94, 0.12),
  v(0.09, -0.94, 0.12),
  v(0, 0.52, 0),
  v(-0.06, 0.44, 0),
  v(0.06, 0.44, 0),
  v(0, 0.64, 0),
  // Left shoulder matches the Phase 0 root offset so the 0.53 m arm reaches the table cup.
  v(-0.18, 0.4, 0.02),
  v(0.18, 0.44, 0),
  v(-0.46, 0.4, 0.02),
  v(0.46, 0.44, 0),
  v(-0.71, 0.4, 0.02),
  v(0.71, 0.44, 0),
  v(0, 0.6, 0.04),
  v(-0.03, 0.68, 0.06),
  v(0.03, 0.68, 0.06),
  ...handOffsets(-1, 0.4, 0.02),
  ...handOffsets(1, 0.44, 0),
];

export interface LimbChain {
  root: number;
  mid: number;
  end: number;
}

const LIMBS: Partial<Record<RigPart, LimbChain>> = {
  left_hand: { root: LEFT_SHOULDER, mid: LEFT_ELBOW, end: LEFT_WRIST },
  right_hand: { root: RIGHT_SHOULDER, mid: RIGHT_ELBOW, end: RIGHT_WRIST },
  left_foot: { root: LEFT_HIP, mid: LEFT_KNEE, end: LEFT_ANKLE },
  right_foot: { root: RIGHT_HIP, mid: RIGHT_KNEE, end: RIGHT_ANKLE },
};

export interface JointPose {
  rotation: Quat;
  translation: Vec3;
}

export interface PoseFrame {
  /** Integer frame on Shot.fps. */
  frame: number;
  joints: readonly JointPose[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class Vec {
  static add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  static sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  static scale(a: Vec3, scalar: number): Vec3 {
    return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
  }

  static dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  static cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  static length(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
  }

  static normalize(a: Vec3): Vec3 {
    const length = Vec.length(a) || 1;
    return Vec.scale(a, 1 / length);
  }

  static lerp(a: Vec3, b: Vec3, amount: number): Vec3 {
    return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
  }
}

export class QuatMath {
  static identity(): Quat {
    return [0, 0, 0, 1];
  }

  static normalize(q: Quat): Quat {
    const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
  }

  /** Hamilton product. `rotate(mul(a, b), v)` equals `rotate(a, rotate(b, v))`. */
  static mul(a: Quat, b: Quat): Quat {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  }

  static rotate(q: Quat, value: Vec3): Vec3 {
    const [qx, qy, qz, qw] = q;
    const [vx, vy, vz] = value;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [
      vx + qw * tx + (qy * tz - qz * ty),
      vy + qw * ty + (qz * tx - qx * tz),
      vz + qw * tz + (qx * ty - qy * tx),
    ];
  }

  static fromAxisAngle(axis: Vec3, angle: number): Quat {
    const normal = Vec.normalize(axis);
    const half = angle / 2;
    const sine = Math.sin(half);
    return [normal[0] * sine, normal[1] * sine, normal[2] * sine, Math.cos(half)];
  }

  static fromYaw(yaw: number): Quat {
    return QuatMath.fromAxisAngle([0, 1, 0], yaw);
  }

  static fromTo(from: Vec3, to: Vec3): Quat {
    if (Vec.length(from) < 1e-8 || Vec.length(to) < 1e-8) return QuatMath.identity();
    const a = Vec.normalize(from);
    const b = Vec.normalize(to);
    const dot = Vec.dot(a, b);
    if (dot > 1 - 1e-8) return QuatMath.identity();
    if (dot < -1 + 1e-8) {
      const axis = Math.abs(a[0]) < 0.9 ? Vec.cross(a, [1, 0, 0]) : Vec.cross(a, [0, 1, 0]);
      return QuatMath.fromAxisAngle(Vec.normalize(axis), Math.PI);
    }
    const cross = Vec.cross(a, b);
    return QuatMath.normalize([cross[0], cross[1], cross[2], 1 + dot]);
  }

  static slerp(start: Quat, end: Quat, amount: number): Quat {
    let bx = end[0];
    let by = end[1];
    let bz = end[2];
    let bw = end[3];
    let dot = start[0] * bx + start[1] * by + start[2] * bz + start[3] * bw;
    if (dot < 0) {
      dot = -dot;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    if (dot > 0.9995) {
      return QuatMath.normalize([
        start[0] + (bx - start[0]) * amount,
        start[1] + (by - start[1]) * amount,
        start[2] + (bz - start[2]) * amount,
        start[3] + (bw - start[3]) * amount,
      ]);
    }
    const theta = Math.acos(Math.min(1, dot));
    const scaleStart = Math.sin((1 - amount) * theta) / Math.sin(theta);
    const scaleEnd = Math.sin(amount * theta) / Math.sin(theta);
    return [
      start[0] * scaleStart + bx * scaleEnd,
      start[1] * scaleStart + by * scaleEnd,
      start[2] * scaleStart + bz * scaleEnd,
      start[3] * scaleStart + bw * scaleEnd,
    ];
  }

  /**
   * Intrinsic XYZ Euler, radians. This is the Three.js `Object3D.rotation` default
   * (`Euler` order `"XYZ"`), which is what shot-record `rotationEuler` plays back.
   * A yaw-about-Y quaternion becomes `[0, yaw, 0]`.
   */
  static toEulerXYZ(q: Quat): Vec3 {
    const [x, y, z, w] = QuatMath.normalize(q);
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    const m13 = 2 * (xz + wy);
    const m11 = 1 - 2 * (yy + zz);
    const m12 = 2 * (xy - wz);
    const m23 = 2 * (yz - wx);
    const m33 = 1 - 2 * (xx + yy);
    const m32 = 2 * (yz + wx);
    const m22 = 1 - 2 * (xx + zz);
    const pitch = Math.asin(clamp(m13, -1, 1));
    if (Math.abs(m13) < 0.999999) {
      return [Math.atan2(-m23, m33), pitch, Math.atan2(-m12, m11)];
    }
    return [Math.atan2(m32, m22), pitch, 0];
  }
}

const childrenOf = (joint: number): number[] =>
  PARENTS.flatMap((parent, index) => (parent === joint ? [index] : []));

const descendants = (joint: number): number[] => {
  const out: number[] = [];
  const walk = (index: number) => {
    for (const child of childrenOf(index)) {
      out.push(child);
      walk(child);
    }
  };
  walk(joint);
  return out;
};

export class SmplxSkeleton {
  static readonly jointCount = SMPLX_JOINT_COUNT;
  static readonly pelvisIndex = PELVIS;

  static limb(part: RigPart): LimbChain | undefined {
    return LIMBS[part];
  }

  /** Rigid T-pose. Every joint shares the pelvis yaw. Translations are global. */
  static restPose(pelvis: Vec3, yaw = 0): JointPose[] {
    const rotation = QuatMath.fromYaw(yaw);
    return REST_OFFSET.map((offset) => ({
      rotation,
      translation: Vec.add(pelvis, QuatMath.rotate(rotation, offset)),
    }));
  }

  static clone(joints: readonly JointPose[]): JointPose[] {
    return joints.map((joint) => ({
      rotation: [joint.rotation[0], joint.rotation[1], joint.rotation[2], joint.rotation[3]],
      translation: [joint.translation[0], joint.translation[1], joint.translation[2]],
    }));
  }
}

export class TwoBoneIk {
  /**
   * Move `limb.end` onto `target` when the target is inside the bone reach.
   * The chain root stays put. Descendants of the end joint keep their offset from it.
   */
  static solve(joints: readonly JointPose[], limb: LimbChain, target: Vec3): JointPose[] {
    const next = SmplxSkeleton.clone(joints);
    const root = next[limb.root]!;
    const mid = next[limb.mid]!;
    const end = next[limb.end]!;
    const solved = TwoBoneIk.solvePositions(root.translation, mid.translation, end.translation, target);
    const wristDelta = Vec.sub(solved.end, end.translation);
    root.rotation = TwoBoneIk.align(root.translation, mid.translation, root.translation, solved.mid, root.rotation);
    mid.rotation = TwoBoneIk.align(mid.translation, end.translation, solved.mid, solved.end, mid.rotation);
    mid.translation = solved.mid;
    end.translation = solved.end;
    for (const index of descendants(limb.end)) {
      const joint = next[index]!;
      joint.translation = Vec.add(joint.translation, wristDelta);
    }
    return next;
  }

  static solvePositions(root: Vec3, mid: Vec3, end: Vec3, target: Vec3): { mid: Vec3; end: Vec3 } {
    const lengthUpper = Math.max(Vec.length(Vec.sub(mid, root)), 1e-4);
    const lengthLower = Math.max(Vec.length(Vec.sub(end, mid)), 1e-4);
    let toward = Vec.sub(target, root);
    let rawLength = Vec.length(toward);
    if (rawLength < 1e-6) {
      toward = Vec.sub(end, root);
      rawLength = Math.max(Vec.length(toward), 1e-4);
    }
    const maxReach = lengthUpper + lengthLower - 1e-4;
    const minReach = Math.abs(lengthUpper - lengthLower) + 1e-4;
    const distance = Math.min(maxReach, Math.max(minReach, rawLength));
    const axis = Vec.scale(toward, 1 / rawLength);
    const pole = Vec.sub(mid, root);
    let bend = Vec.sub(pole, Vec.scale(axis, Vec.dot(pole, axis)));
    if (Vec.length(bend) < 1e-5) {
      const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      bend = Vec.cross(axis, helper);
    }
    bend = Vec.normalize(bend);
    const cosShoulder = clamp(
      (lengthUpper * lengthUpper + distance * distance - lengthLower * lengthLower) / (2 * lengthUpper * distance),
      -1,
      1,
    );
    const sinShoulder = Math.sqrt(Math.max(0, 1 - cosShoulder * cosShoulder));
    return {
      mid: Vec.add(root, Vec.add(Vec.scale(axis, cosShoulder * lengthUpper), Vec.scale(bend, sinShoulder * lengthUpper))),
      end: Vec.add(root, Vec.scale(axis, distance)),
    };
  }

  private static align(oldParent: Vec3, oldChild: Vec3, newParent: Vec3, newChild: Vec3, rotation: Quat): Quat {
    const delta = QuatMath.fromTo(Vec.sub(oldChild, oldParent), Vec.sub(newChild, newParent));
    return QuatMath.mul(delta, rotation);
  }
}

interface TimedJoints {
  time: number;
  joints: readonly JointPose[];
}

export class PoseResample {
  /**
   * Model sample times covering shot frames `0 .. frameCount-1` at `modelFps`.
   * The last shot frame is `(frameCount - 1) / shotFps` seconds, not an extra frame past the clock.
   */
  static modelTimes(shotFps: number, frameCount: number, modelFps: number): number[] {
    const end = frameCount <= 1 ? 0 : (frameCount - 1) / shotFps;
    const count = Math.max(1, Math.round(end * modelFps) + 1);
    return Array.from({ length: count }, (_, index) => index / modelFps);
  }

  /** Sample model-time joint tracks onto integer shot frames. Positions lerp, rotations slerp. */
  static toShotFrames(samples: readonly TimedJoints[], shotFps: number, frameCount: number): PoseFrame[] {
    const ordered = [...samples].sort((left, right) => left.time - right.time);
    return Array.from({ length: frameCount }, (_, frame) => ({
      frame,
      joints: PoseResample.mixAt(ordered, frame / shotFps),
    }));
  }

  private static mixAt(samples: readonly TimedJoints[], time: number): JointPose[] {
    const first = samples[0];
    if (!first) return [];
    if (samples.length === 1 || time <= first.time) return SmplxSkeleton.clone(first.joints);
    const last = samples[samples.length - 1]!;
    if (time >= last.time) return SmplxSkeleton.clone(last.joints);
    const after = samples.findIndex((sample) => sample.time > time);
    const right = samples[after]!;
    const left = samples[after - 1]!;
    const span = right.time - left.time;
    const amount = span > 0 ? (time - left.time) / span : 0;
    return left.joints.map((joint, index) => {
      const next = right.joints[index] ?? joint;
      return {
        rotation: QuatMath.slerp(joint.rotation, next.rotation, amount),
        translation: Vec.lerp(joint.translation, next.translation, amount),
      };
    });
  }
}
