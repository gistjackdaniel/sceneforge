import * as THREE from "three";

/**
 * Shot pose euler order.
 * PR #34 exports this as `EULER_ORDER` from `domain/shot/euler.ts`.
 * That file is not on `feat/shot-record`, so the preview keeps the same literal.
 */
export const EULER_ORDER = "XYZ" as const;

/** `THREE.Euler(..., EULER_ORDER)` → quaternion `[x, y, z, w]`. */
export const eulerToQuaternion = (
  euler: readonly [number, number, number],
): [number, number, number, number] => {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(euler[0], euler[1], euler[2], EULER_ORDER),
  );
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

/** Quaternion `[x, y, z, w]` → `THREE.Euler` in `EULER_ORDER`. */
export const quaternionToEuler = (
  quaternion: readonly [number, number, number, number],
): [number, number, number] => {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
    EULER_ORDER,
  );
  return [euler.x, euler.y, euler.z];
};
