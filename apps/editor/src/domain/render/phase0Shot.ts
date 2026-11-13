import * as THREE from "three";
import { parseShot } from "../shot/schema";
import type { Quat, Shot, Vec3 } from "../shot/types";
import type { AssetRevisionKey } from "./passHash";

/** Phase 0 set positions, meters, Y-up. */
export const PHASE0_TABLE: Vec3 = [1.25, 0.72, 0.1];
export const PHASE0_ACTOR_A: Vec3 = [1.001, 0.38, -0.309];
export const PHASE0_ACTOR_B: Vec3 = [2.001, 0.38, -0.309];

export const PHASE0_IDS = {
  shot: "shot-phase0",
  actorA: "act_phase0_actor_a",
  actorB: "act_phase0_actor_b",
  cup: "obj_phase0_cup",
  table: "obj_phase0_table",
  room: "room_phase0",
  take: "take-shot-phase0-1",
} as const;

export const PHASE0_ASSET_REVISION: AssetRevisionKey = {
  assetId: "ast_phase0_set",
  revisionId: "rev_phase0_1",
};

export const PHASE0_SEED = 0;

const NOW = "2026-11-12T00:00:00.000Z";

const lookRotation = (eye: Vec3, target: Vec3): Quat => {
  // Camera.lookAt aims local -Z at the target. Object3D.lookAt aims +Z.
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 1, 0);
  camera.position.set(eye[0], eye[1], eye[2]);
  camera.lookAt(target[0], target[1], target[2]);
  return [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w];
};

const human = (id: string, name: string, uri: string, position: Vec3) => ({
  id,
  assetId: `file:${name.toLowerCase()}`,
  assetVersion: 1,
  name,
  uri,
  visible: true,
  locked: false,
  kind: "human" as const,
  representation: "mesh" as const,
  placement: { position, rotationEuler: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 },
  motion: {
    channel: "explicit" as const,
    interpolation: "hold" as const,
    keys: [{ frame: 0, position, rotationEuler: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 }],
    provenance: { kind: "keyed" as const },
  },
});

const prop = (id: string, name: string, uri: string, position: Vec3, scale: Vec3) => ({
  id,
  assetId: `file:${name.toLowerCase()}`,
  assetVersion: 1,
  name,
  uri,
  visible: true,
  locked: false,
  kind: "object" as const,
  representation: "box" as const,
  placement: { position, rotationEuler: [0, 0, 0] as Vec3, scale },
  motion: { channel: "unset" as const },
});

/**
 * 8 seconds at 16 fps (128 frames): two actors, a cup, a table, one room, one camera.
 * Returned shot is the JSON round-trip of that document.
 */
export const phase0Shot = (): Shot => {
  const target: Vec3 = [1.45, 0.9, -0.2];
  const eye0: Vec3 = [1.55, 1.32, 2.5];
  const eye1: Vec3 = [1.2, 1.22, 2.2];
  const raw = {
    schemaVersion: 1 as const,
    id: PHASE0_IDS.shot,
    name: "Phase 0",
    time: { fps: 16, durationFrames: 128, origin: "clip_local" as const },
    subjects: [
      human(PHASE0_IDS.actorA, "A", "actors/a.glb", PHASE0_ACTOR_A),
      human(PHASE0_IDS.actorB, "B", "actors/b.glb", PHASE0_ACTOR_B),
      prop(PHASE0_IDS.cup, "Cup", "props/cup.glb", [1.48, 0.84, 0.16], [0.16, 0.14, 0.16]),
      prop(PHASE0_IDS.table, "Table", "props/table.glb", PHASE0_TABLE, [0.8, 0.04, 0.36]),
    ],
    camera: {
      status: "ready" as const,
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8, sensorPreset: "full-frame" },
      interpolation: "linear" as const,
      selectedTakeId: PHASE0_IDS.take,
      takes: [
        {
          schemaVersion: 1 as const,
          id: PHASE0_IDS.take,
          name: "Take 1",
          source: "manual" as const,
          createdAt: NOW,
          keys: [
            { frame: 0, position: eye0, rotation: lookRotation(eye0, target), focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
            { frame: 96, position: eye1, rotation: lookRotation(eye1, target), focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
          ],
        },
      ],
    },
    environment: { worldId: PHASE0_IDS.room },
    renders: [],
  };
  return parseShot(JSON.parse(JSON.stringify(raw)));
};
