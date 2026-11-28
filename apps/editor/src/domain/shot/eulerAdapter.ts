import type { Quat, Vec3 } from "./types";

/**
 * Euler order for shot `rotationEuler`.
 * Scene 레인 확정(StageViewport.tsx 기준). Three.js `Object3D.rotation` 기본 intrinsic XYZ.
 * `viewportCommit.ts`의 ZYX 근사는 이 순서가 아니다. Scene 레인이 그 파일을 고친다.
 */
export const SHOT_EULER_ORDER = "XYZ" as const;

export type ShotEulerOrder = typeof SHOT_EULER_ORDER;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeQuat = (quat: Quat): Quat => {
  const length = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
  if (!(length > 0)) return [0, 0, 0, 1];
  return [quat[0] / length, quat[1] / length, quat[2] / length, quat[3] / length];
};

/**
 * Intrinsic XYZ euler (radians) to a unit quaternion `[x, y, z, w]`.
 * Matches Three.js `Quaternion.setFromEuler` for order `XYZ`.
 * Shot documents keep euler. Call this only at the coordinate-contract boundary.
 */
export const eulerToQuaternion = (euler: Vec3): Quat => {
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

const plain = (value: number) => (Object.is(value, -0) ? 0 : value);

/**
 * Unit quaternion `[x, y, z, w]` to intrinsic XYZ euler (radians).
 * Away from gimbal lock this inverts `eulerToQuaternion`. At ±90° pitch, yaw is folded into roll.
 * Matches Three.js `Euler.setFromRotationMatrix` for order `XYZ`.
 */
export const quaternionToEuler = (quat: Quat): Vec3 => {
  const [x, y, z, w] = normalizeQuat(quat);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const r00 = 1 - 2 * (yy + zz);
  const r01 = 2 * (xy - wz);
  const r02 = 2 * (xz + wy);
  const r11 = 1 - 2 * (xx + zz);
  const r12 = 2 * (yz - wx);
  const r21 = 2 * (yz + wx);
  const r22 = 1 - 2 * (xx + yy);
  const pitch = Math.asin(clamp(r02, -1, 1));
  if (Math.abs(r02) < 0.9999999) {
    const roll = Math.atan2(-r12, r22);
    const yaw = Math.atan2(-r01, r00);
    return [plain(roll), plain(pitch), plain(yaw)];
  }
  return [plain(Math.atan2(r21, r11)), plain(pitch), 0];
};
