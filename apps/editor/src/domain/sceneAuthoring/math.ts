/** Right-handed, Y-up, meters. Quaternions are [x, y, z, w], the same order as THREE.Quaternion. */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const quatIdentity = (): Quat => [0, 0, 0, 1];

export const quatFromAxisAngle = (axis: Vec3, radians: number): Quat => {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const scale = Math.sin(radians / 2) / length;
  return [axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(radians / 2)];
};

export const quatNormalize = (q: Quat): Quat => {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
};

/** Hamilton product. `quatMul(a, b)` applies `b` first, then `a`. */
export const quatMul = (a: Quat, b: Quat): Quat => {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
};

const quatConjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export const quatRotate = (q: Quat, v: Vec3): Vec3 => {
  const rotated = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), quatConjugate(q));
  return [rotated[0], rotated[1], rotated[2]];
};

export const quatSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;
  return [a[0] * w1 + bx * w2, a[1] * w1 + by * w2, a[2] * w1 + bz * w2, a[3] * w1 + bw * w2];
};

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const midpoint = (a: Vec3, b: Vec3): Vec3 => lerpVec3(a, b, 0.5);

export const distance = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const asVec3 = (value: readonly [number, number, number]): Vec3 => [value[0], value[1], value[2]];

export const asQuat = (value: readonly [number, number, number, number]): Quat => [value[0], value[1], value[2], value[3]];

/** Row-major 4×4. Translation is the fourth column, matching `T_world_obj`. */
export type Mat4 = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

export const translationOf = (matrix: Mat4): Vec3 => [matrix[0][3], matrix[1][3], matrix[2][3]];

/** Rigid transform. Rotation is a quaternion `[x, y, z, w]`. */
export const worldMatrix = (translation: readonly number[], rotation: Quat = quatIdentity()): Mat4 => {
  const [x, y, z, w] = quatNormalize(rotation);
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
