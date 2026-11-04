/** Unit quaternion stored as `[x, y, z, w]`, matching `THREE.Quaternion`. */
export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Normalize a quaternion. A zero-length input becomes identity.
 * Viewport playback, Backbone export, and track resolution all use this storage.
 */
export const normalizeQuat = (quaternion: Quat): Quat => {
  const mag = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  if (mag < 1e-12) {
    return [0, 0, 0, 1];
  }
  return [quaternion[0] / mag, quaternion[1] / mag, quaternion[2] / mag, quaternion[3] / mag];
};

/**
 * Euler XYZ (radians) → quaternion. Same composition as `THREE.Euler` order `"XYZ"`
 * and `THREE.Quaternion.setFromEuler`. This is the only Euler order the viewport may use.
 */
export const eulerToQuaternionXYZ = (euler: Vec3): Quat => {
  const [x, y, z] = euler;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return normalizeQuat([
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]);
};

/**
 * Quaternion → Euler XYZ (radians). Inverse of `eulerToQuaternionXYZ`, including the
 * same gimbal lock branch as `THREE.Euler.setFromRotationMatrix` order `"XYZ"`.
 */
export const quaternionToEulerXYZ = (quaternion: Quat): Vec3 => {
  const [x, y, z, w] = normalizeQuat(quaternion);
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m23, m33), pitch, Math.atan2(-m12, m11)];
  }
  return [Math.atan2(m32, m22), pitch, 0];
};

/**
 * Historical encoder. `eulerToQuaternionApprox` used this ZYX composition while the
 * viewport applied the same numbers as XYZ. Kept only to migrate those stored quaternions.
 */
export const eulerToQuaternionZYX = (euler: Vec3): Quat => {
  const [x, y, z] = euler;
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return normalizeQuat([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
};

/** Inverse of `eulerToQuaternionZYX`. Migration reads stored quaternions with this decoder. */
export const quaternionToEulerZYX = (quaternion: Quat): Vec3 => {
  const [x, y, z, w] = normalizeQuat(quaternion);
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [roll, pitch, yaw];
};

/**
 * Convert a quaternion that was produced by the old ZYX encoder from viewport XYZ
 * Euler components into the quaternion the viewport was actually showing.
 * Identity and single-axis rotations are unchanged. Not idempotent — call once.
 */
export const migrateZyxEncodedQuaternion = (quaternion: Quat): Quat =>
  eulerToQuaternionXYZ(quaternionToEulerZYX(quaternion));

/** Smallest angle in radians between two orientations. q and -q are the same rotation. */
export const quaternionAngleRadians = (a: Quat, b: Quat): number => {
  const left = normalizeQuat(a);
  const right = normalizeQuat(b);
  const dot = Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3]);
  return 2 * Math.acos(clamp(dot, -1, 1));
};

export const conjugateQuat = (quaternion: Quat): Quat => {
  const [x, y, z, w] = normalizeQuat(quaternion);
  return [-x, -y, -z, w];
};

/** Hamilton product without renormalization. Vector sandwiches must keep their magnitude. */
const hamilton = (a: Quat, b: Quat): Quat => {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
};

/** Hamilton product. Applies `b` first, then `a`, matching `THREE.Quaternion.multiply`. */
export const multiplyQuat = (a: Quat, b: Quat): Quat => normalizeQuat(hamilton(a, b));

/**
 * Rotate a vector by a quaternion: `q * v * q⁻¹`.
 * The pure-quaternion intermediate is not normalized, so position length is preserved.
 */
export const rotateVec3 = (quaternion: Quat, vector: Vec3): Vec3 => {
  const q = normalizeQuat(quaternion);
  const rotated = hamilton(hamilton(q, [vector[0], vector[1], vector[2], 0]), conjugateQuat(q));
  return [rotated[0], rotated[1], rotated[2]];
};

export const slerpQuat = (a: Quat, b: Quat, t: number): Quat => {
  const left = normalizeQuat(a);
  let dot = left[0] * b[0] + left[1] * b[1] + left[2] * b[2] + left[3] * b[3];
  const right: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [b[0], b[1], b[2], b[3]];
  if (dot < 0) {
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuat([
      left[0] + (right[0] - left[0]) * t,
      left[1] + (right[1] - left[1]) * t,
      left[2] + (right[2] - left[2]) * t,
      left[3] + (right[3] - left[3]) * t,
    ]);
  }
  const theta = Math.acos(clamp(dot, -1, 1));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return normalizeQuat([
    left[0] * wa + right[0] * wb,
    left[1] * wa + right[1] * wb,
    left[2] * wa + right[2] * wb,
    left[3] * wa + right[3] * wb,
  ]);
};

export interface ViewportOrientationPose {
  /** Stored camera orientation. Wins over `rotation` so Euler order cannot change the shot. */
  quaternion?: Quat;
  /** Euler XYZ radians. Used only when `quaternion` is absent. */
  rotation: Vec3;
}

/**
 * Orientation the shot camera applies. Quaternion storage is the source of truth;
 * Euler XYZ is a fallback for callers that have not supplied one yet.
 */
export const viewportShotQuaternion = (pose: ViewportOrientationPose): Quat =>
  pose.quaternion ? normalizeQuat(pose.quaternion) : eulerToQuaternionXYZ(pose.rotation);
