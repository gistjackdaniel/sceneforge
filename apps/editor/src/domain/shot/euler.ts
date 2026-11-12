import * as THREE from "three";

/**
 * Intrinsic Euler order for stored subject `rotationEuler` and for camera commits.
 * This is Three.js `Object3D.rotation.order` (`"XYZ"`). Do not add a second order.
 */
export const EULER_ORDER = "XYZ" as const;

const tuple3 = (euler: THREE.Euler): [number, number, number] => [euler.x, euler.y, euler.z];

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
): [number, number, number] =>
  tuple3(
    new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
      EULER_ORDER,
    ),
  );
