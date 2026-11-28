import type { SceneState } from "../../domain/worlds/sceneState";
import { riggedActorSourceKey, type RiggedActorImportSource, type RiggedActorSourceAxes } from "../../domain/worlds/riggedActorImport";
import type { DomainCommand } from "./types";

/**
 * glTF 2.0 source frame.
 * +Y up, meters, right-handed, +Z front.
 * Passed explicitly. World converts into the scene contract and mints `act_<ULID>`.
 */
export const GLTF_SOURCE_AXES: RiggedActorSourceAxes = {
  coordinateSystem: "Y_UP",
  upAxis: "Y",
  handedness: "right",
  frontAxis: "+Z",
  metersPerUnit: 1,
};

export type GltfRiggedActorLoad = {
  worldId: string;
  assetId: string;
  revisionId: string;
  sourcePath: string;
  nodeName: string;
  bones: readonly { name: string }[];
  label: string;
  restTranslation?: readonly [number, number, number];
  restRotation?: readonly [number, number, number, number];
  restScale?: readonly [number, number, number];
  legacySubjectId?: string;
  shotId?: string;
  legacyAssetId?: string;
};

const triple = (value: readonly [number, number, number]): [number, number, number] => [value[0], value[1], value[2]];

const quad = (
  value: readonly [number, number, number, number],
): [number, number, number, number] => [value[0], value[1], value[2], value[3]];

/**
 * Undoable import command for one glTF rig.
 * No skinned bones means there is no actor to import.
 * Does not mint an id and does not convert coordinates.
 */
export const gltfRiggedActorCommand = (load: GltfRiggedActorLoad): DomainCommand | undefined => {
  if (load.bones.length === 0) return undefined;
  const source: RiggedActorImportSource = {
    assetId: load.assetId,
    revisionId: load.revisionId,
    sourcePath: load.sourcePath,
    nodeName: load.nodeName,
    bones: load.bones.map((bone) => ({ name: bone.name })),
    label: load.label,
    sourceAxes: { ...GLTF_SOURCE_AXES },
    ...(load.restTranslation ? { restTranslation: triple(load.restTranslation) } : {}),
    ...(load.restRotation ? { restRotation: quad(load.restRotation) } : {}),
    ...(load.restScale ? { restScale: triple(load.restScale) } : {}),
    ...(load.legacySubjectId ? { legacySubjectId: load.legacySubjectId } : {}),
    ...(load.shotId ? { shotId: load.shotId } : {}),
    ...(load.legacyAssetId ? { legacyAssetId: load.legacyAssetId } : {}),
  };
  return { type: "IMPORT_RIGGED_ACTOR", worldId: load.worldId, source };
};

/**
 * True when this source key already has a live actor and the shot subject is already linked.
 * A repeat viewport load can skip the command. Undo removes the actor, so the next load imports again.
 */
export const rigImportAlreadyApplied = (
  scene: SceneState | undefined,
  source: RiggedActorImportSource,
): boolean => {
  if (!scene) return false;
  let key: string;
  try {
    key = riggedActorSourceKey(source);
  } catch {
    return false;
  }
  const actor = Object.values(scene.actors).find((item) => item.importKey === key && !item.deletedAt);
  if (!actor) return false;
  const subject = source.legacySubjectId?.trim();
  if (!subject) return true;
  return actor.legacyRefs.some((ref) => ref.kind === "shot_subject" && ref.subjectId === subject);
};
