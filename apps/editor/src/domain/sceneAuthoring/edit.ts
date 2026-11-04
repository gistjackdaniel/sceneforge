import type { Project } from "../project/types";
import type { WorldAsset } from "../worlds/types";
import {
  contactEffectorOverrideSchema,
  interactiveSceneSchema,
  type ContactEffectorOverride,
  type InteractiveScene,
  type RigPart,
} from "./contract";
import { createHandshakePreviewScene, createHandshakeWorlds, HANDSHAKE_SCENE_ID } from "./fixture";
import { resolveContacts } from "./playback";
import { resolveSubjectByName } from "./resolveSubject";

export interface InstallResult {
  project: Project;
  addedScene: boolean;
  addedWorldIds: string[];
}

/**
 * Add the handshake preview worlds and scene if they are missing.
 * Existing worlds and an existing scene are left as they are.
 * Does not mutate `project`.
 */
export const installInteractionScene = (project: Project): InstallResult => {
  const worlds = createHandshakeWorlds();
  let nextWorlds: Record<string, WorldAsset> = project.worlds;
  const addedWorldIds: string[] = [];
  for (const asset of worlds) {
    if (nextWorlds[asset.id]) continue;
    nextWorlds = { ...nextWorlds, [asset.id]: asset };
    addedWorldIds.push(asset.id);
  }
  const existing = project.interactiveScenes?.[HANDSHAKE_SCENE_ID];
  if (existing && addedWorldIds.length === 0) {
    return { project, addedScene: false, addedWorldIds: [] };
  }
  const scenes = { ...(project.interactiveScenes ?? {}) };
  let addedScene = false;
  if (!existing) {
    scenes[HANDSHAKE_SCENE_ID] = createHandshakePreviewScene();
    addedScene = true;
  }
  return {
    project: { ...project, worlds: nextWorlds, interactiveScenes: scenes },
    addedScene,
    addedWorldIds,
  };
};

/**
 * Remove only the worlds and scene a previous install added.
 * Does not mutate `project`.
 */
export const uninstallInteractionScene = (
  project: Project,
  sceneId: string,
  removeScene: boolean,
  worldIds: readonly string[],
): Project => {
  const worlds = { ...project.worlds };
  for (const worldId of worldIds) delete worlds[worldId];
  const scenes = { ...(project.interactiveScenes ?? {}) };
  if (removeScene) delete scenes[sceneId];
  return { ...project, worlds, interactiveScenes: scenes };
};

export interface EffectorChange {
  sceneId: string;
  subjectRef: string;
  locale: "ko" | "en";
  contactId: string;
  rigPart: RigPart;
}

export type EditOutcome =
  | { changed: false; project: Project }
  | { changed: true; project: Project; previous: ContactEffectorOverride[] }
  | { error: string };

const readScene = (project: Project, sceneId: string): InteractiveScene | { error: string } => {
  const scene = project.interactiveScenes?.[sceneId];
  if (!scene) return { error: "상호작용 장면이 없습니다." };
  const parsed = interactiveSceneSchema.safeParse(scene);
  if (!parsed.success) return { error: "장면 기록을 읽지 못했습니다." };
  return scene;
};

const writeOverrides = (
  project: Project,
  scene: InteractiveScene,
  overrides: ContactEffectorOverride[],
): Project => ({
  ...project,
  interactiveScenes: {
    ...(project.interactiveScenes ?? {}),
    [scene.id]: { ...scene, overrides },
  },
});

/**
 * Point one contact effector at a different rig part.
 *
 * The name is resolved through TargetResolver to a WorldAsset.id, then to the
 * scene's instance id. Source contacts and pose clips are copied by reference,
 * not rewritten. The change is stored as an override list.
 */
export const changeContactEffector = (project: Project, change: EffectorChange): EditOutcome => {
  const scene = readScene(project, change.sceneId);
  if ("error" in scene) return scene;
  const subject = resolveSubjectByName(project.worlds, scene.subjects, change.subjectRef, change.locale);
  if ("error" in subject) return subject;
  const source = scene.contacts.find((contact) => contact.contactId === change.contactId);
  if (!source) return { error: "접촉 이벤트를 찾지 못했습니다." };
  const onA = source.a.instanceId === subject.instanceId;
  const onB = source.b.instanceId === subject.instanceId;
  if (!onA && !onB) return { error: "이 접촉에 그 대상이 없습니다." };
  const resolved = resolveContacts(scene).find((contact) => contact.contactId === change.contactId);
  const currentPart = onA ? resolved?.a.rigPart : resolved?.b.rigPart;
  if (currentPart === change.rigPart) return { changed: false, project };
  const sourcePart = onA ? source.a.rigPart : source.b.rigPart;
  const without = scene.overrides.filter((override) => override.contactId !== change.contactId);
  const nextOverrides =
    change.rigPart === sourcePart
      ? without
      : [
          ...without,
          contactEffectorOverrideSchema.parse({
            contactId: change.contactId,
            worldAssetId: subject.worldAssetId,
            instanceId: subject.instanceId,
            rigPart: change.rigPart,
          }),
        ];
  return {
    changed: true,
    previous: scene.overrides,
    project: writeOverrides(project, scene, nextOverrides),
  };
};

/** Replace the override list. Used by undo. Source contacts stay on the same objects. */
export const setInteractionOverrides = (
  project: Project,
  sceneId: string,
  overrides: ContactEffectorOverride[],
): EditOutcome => {
  const scene = readScene(project, sceneId);
  if ("error" in scene) return scene;
  const parsed = contactEffectorOverrideSchema.array().safeParse(overrides);
  if (!parsed.success) return { error: "접촉 수정 기록을 읽지 못했습니다." };
  if (canonicalizeOverrides(scene.overrides) === canonicalizeOverrides(parsed.data)) {
    return { changed: false, project };
  }
  return {
    changed: true,
    previous: scene.overrides,
    project: writeOverrides(project, scene, parsed.data),
  };
};

const canonicalizeOverrides = (overrides: readonly ContactEffectorOverride[]): string =>
  JSON.stringify(
    [...overrides].sort((left, right) => left.contactId.localeCompare(right.contactId)),
  );
