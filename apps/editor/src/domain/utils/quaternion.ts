export type Quaternion = [number, number, number, number];
export type AxisAngle = [number, number, number]; // axis * angle radians (axis scaled by angle magnitude)

const EPS = 1e-8;

export const clamp = (x: number, min: number, max: number): number => Math.max(min, Math.min(max, x));

/** Convert axis-angle (axis scaled by angle) to quaternion [x,y,z,w]. */
export const axisAngleToQuaternion = (aa: AxisAngle): Quaternion => {
  const ax = aa[0], ay = aa[1], az = aa[2];
  const angle = Math.sqrt(ax * ax + ay * ay + az * az);
  if (angle < EPS) return [0, 0, 0, 1];
  const nx = ax / angle, ny = ay / angle, nz = az / angle;
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [nx * s, ny * s, nz * s, Math.cos(half)];
};

/** Convert quaternion to axis-angle (axis scaled by angle), minimizing angle to [0, pi]. */
export const quaternionToAxisAngle = (q: Quaternion): AxisAngle => {
  const [x, y, z, w] = normalizeQuaternion(q);
  const angle = 2 * Math.acos(clamp(w, -1, 1));
  const s = Math.sqrt(1 - w * w);
  if (s < EPS || angle < EPS) return [0, 0, 0];
  return [(x / s) * angle, (y / s) * angle, (z / s) * angle];
};

/** Normalize quaternion to unit length. */
export const normalizeQuaternion = (q: Quaternion): Quaternion => {
  const [x, y, z, w] = q;
  const len = Math.hypot(x, y, z, w);
  if (len < EPS) return [0, 0, 0, 1];
  const inv = 1 / len;
  return [x * inv, y * inv, z * inv, w * inv];
};

/** Dot product between two quaternions. */
export const dotQuaternion = (a: Quaternion, b: Quaternion): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** Spherical linear interpolation between two quaternions. t in [0,1]. */
export const slerpQuaternion = (qa: Quaternion, qb: Quaternion, t: number): Quaternion => {
  let a = normalizeQuaternion(qa);
  let b = normalizeQuaternion(qb);
  let cosHalfTheta = dotQuaternion(a, b);
  // Take shortest path
  if (cosHalfTheta < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta > 0.9995) {
    // Linear fallback for near-identical quats
    const x = a[0] + t * (b[0] - a[0]);
    const y = a[1] + t * (b[1] - a[1]);
    const z = a[2] + t * (b[2] - a[2]);
    const w = a[3] + t * (b[3] - a[3]);
    return normalizeQuaternion([x, y, z, w]);
  }
  const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return [
    a[0] * ratioA + b[0] * ratioB,
    a[1] * ratioA + b[1] * ratioB,
    a[2] * ratioA + b[2] * ratioB,
    a[3] * ratioA + b[3] * ratioB,
  ];
};

/** Compose rotations: qa then qb. */
export const multiplyQuaternion = (qa: Quaternion, qb: Quaternion): Quaternion => {
  const [ax, ay, az, aw] = qa;
  const [bx, by, bz, bw] = qb;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
};

