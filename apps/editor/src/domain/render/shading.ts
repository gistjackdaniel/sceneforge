import * as THREE from "three";
import type { InstanceIdEntry } from "./types";

/** Fixed sun for the protected path. Shot lights are not sampled in this version. */
export const LIGHT_VECTOR = [0.32, 0.87, 0.28] as const;

export const lightDirection = (): THREE.Vector3 =>
  new THREE.Vector3(LIGHT_VECTOR[0], LIGHT_VECTOR[1], LIGHT_VECTOR[2]).normalize();

/** Role albedo in 0–255. Index and id strings must not affect RGB. */
export const ALBEDO: Record<InstanceIdEntry["role"], readonly [number, number, number]> = {
  actor: [196, 164, 132],
  object: [176, 112, 64],
  room: [168, 172, 176],
};

export const shadeByte = (albedo: number, normal: THREE.Vector3, light: THREE.Vector3): number => {
  const shade = 0.18 + 0.82 * Math.max(0, Math.min(1, normal.dot(light)));
  return Math.min(255, Math.max(0, Math.round(albedo * shade)));
};
