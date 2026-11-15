import { eulerToQuaternion } from "./euler";

/** Unit quaternion stored as `[x, y, z, w]`, matching `THREE.Quaternion`. */
export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Normalize a quaternion. A zero-length input becomes identity. */
export const normalizeQuat = (quaternion: readonly number[]): [number, number, number, number] => {
  const mag = Math.hypot(quaternion[0] ?? 0, quaternion[1] ?? 0, quaternion[2] ?? 0, quaternion[3] ?? 0);
  if (mag < 1e-12) return [0, 0, 0, 1];
  return [
    (quaternion[0] ?? 0) / mag,
    (quaternion[1] ?? 0) / mag,
    (quaternion[2] ?? 0) / mag,
    (quaternion[3] ?? 0) / mag,
  ];
};

/**
 * Historical camera encoder. `eulerToQuaternionApprox` composed ZYX while the viewport
 * applied the same numbers with `Object3D.rotation` (XYZ). Used only to migrate those quaternions.
 */
export const eulerToQuaternionZYX = (euler: readonly [number, number, number]): [number, number, number, number] => {
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

/** Inverse of `eulerToQuaternionZYX`. */
export const quaternionToEulerZYX = (
  quaternion: readonly [number, number, number, number],
): [number, number, number] => {
  const [x, y, z, w] = normalizeQuat(quaternion);
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [roll, pitch, yaw];
};

/**
 * A quaternion produced by the old ZYX encoder, rewritten as the XYZ quaternion the viewport showed.
 * Not idempotent — call once, then store `rotationStorage: "quaternion_xyzw"`.
 */
export const migrateZyxEncodedQuaternion = (
  quaternion: readonly [number, number, number, number],
): [number, number, number, number] => eulerToQuaternion(quaternionToEulerZYX(quaternion));

/** Smallest angle in radians between two orientations. q and -q are the same rotation. */
export const quaternionAngleRadians = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number => {
  const left = normalizeQuat(a);
  const right = normalizeQuat(b);
  const dot = Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3]);
  return 2 * Math.acos(clamp(dot, -1, 1));
};

const hamilton = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] => {
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
export const multiplyQuat = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] => normalizeQuat(hamilton(normalizeQuat(a), normalizeQuat(b)));

/** Rotate a vector by a quaternion. The pure-quaternion intermediate is not normalized. */
export const rotateVec3 = (
  quaternion: readonly [number, number, number, number],
  vector: readonly [number, number, number],
): [number, number, number] => {
  const q = normalizeQuat(quaternion);
  const rotated = hamilton(hamilton(q, [vector[0], vector[1], vector[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [rotated[0], rotated[1], rotated[2]];
};

export const slerpQuat = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): [number, number, number, number] => {
  const left = normalizeQuat(a);
  let dot = left[0] * b[0] + left[1] * b[1] + left[2] * b[2] + left[3] * b[3];
  const right: [number, number, number, number] = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [b[0], b[1], b[2], b[3]];
  if (dot < 0) dot = -dot;
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
