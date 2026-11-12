import type { Project } from "../project/types";
import type { Shot } from "../shot/types";
import {
  contactEffectorOverrideSchema,
  interactionPreviewSchema,
  type ContactEffectorOverride,
  type InteractionPreviewRecord,
  type RigPart,
} from "./contract";
import { resolveContacts } from "./contacts";
import {
  createHandshakePreviewRecord,
  createHandshakeShot,
  createHandshakeWorlds,
  HANDSHAKE_SHOT_ID,
} from "./fixture";
import { resolveSubjectByName } from "./resolveSubject";

export interface InstallResult {
  project: Project;
  addedShot: boolean;
  addedPreview: boolean;
  addedWorldIds: string[];
}

/**
 * Add the handshake worlds, shot, and contact record if they are missing.
 * An existing shot, including its camera take and subject motion, is left as it is.
 * Does not mutate `project`.
 */
export const installInteractionScene = (project: Project): InstallResult => {
  const worlds = createHandshakeWorlds();
  let nextWorlds: Record<string, typeof worlds[number]> = project.worlds;
  const addedWorldIds: string[] = [];
  for (const asset of worlds) {
    if (nextWorlds[asset.id]) continue;
    nextWorlds = { ...nextWorlds, [asset.id]: asset };
    addedWorldIds.push(asset.id);
  }
  const shots = { ...(project.shots ?? {}) };
  let addedShot = false;
  if (!shots[HANDSHAKE_SHOT_ID]) {
    shots[HANDSHAKE_SHOT_ID] = createHandshakeShot();
    addedShot = true;
  }
  const previews = { ...(project.interactionPreviews ?? {}) };
  let addedPreview = false;
  if (!previews[HANDSHAKE_SHOT_ID]) {
    previews[HANDSHAKE_SHOT_ID] = createHandshakePreviewRecord();
    addedPreview = true;
  }
  if (!addedShot && !addedPreview && addedWorldIds.length === 0) {
    return { project, addedShot: false, addedPreview: false, addedWorldIds: [] };
  }
  return {
    project: { ...project, worlds: nextWorlds, shots, interactionPreviews: previews },
    addedShot,
    addedPreview,
    addedWorldIds,
  };
};

/**
 * Remove only the worlds, shot, and preview a previous install added.
 * Does not mutate `project`.
 */
export const uninstallInteractionScene = (
  project: Project,
  shotId: string,
  removeShot: boolean,
  removePreview: boolean,
  worldIds: readonly string[],
): Project => {
  const worlds = { ...project.worlds };
  for (const worldId of worldIds) delete worlds[worldId];
  const shots = { ...(project.shots ?? {}) };
  if (removeShot) delete shots[shotId];
  const interactionPreviews = { ...(project.interactionPreviews ?? {}) };
  if (removePreview) delete interactionPreviews[shotId];
  return { ...project, worlds, shots, interactionPreviews };
};

export interface EffectorChange {
  shotId: string;
  subjectRef: string;
  locale: "ko" | "en";
  contactId: string;
  rigPart: RigPart;
}

export type EditOutcome =
  | { changed: false; project: Project }
  | { changed: true; project: Project; previous: ContactEffectorOverride[] }
  | { error: string };

const readPreview = (project: Project, shotId: string): { shot: Shot; preview: InteractionPreviewRecord } | { error: string } => {
  const shot = project.shots?.[shotId];
  if (!shot) return { error: "샷 기록이 없습니다." };
  const preview = project.interactionPreviews?.[shotId];
  if (!preview) return { error: "상호작용 기록이 없습니다." };
  const parsed = interactionPreviewSchema.safeParse(preview);
  if (!parsed.success) return { error: "상호작용 기록을 읽지 못했습니다." };
  return { shot, preview: parsed.data };
};

const writeOverrides = (
  project: Project,
  preview: InteractionPreviewRecord,
  overrides: ContactEffectorOverride[],
): Project => ({
  ...project,
  interactionPreviews: {
    ...(project.interactionPreviews ?? {}),
    [preview.shotId]: { ...preview, overrides },
  },
});

/**
 * Point one contact effector at a different rig part.
 *
 * The name is resolved through TargetResolver to a WorldAsset.id, then to the
 * shot subject with that asset id. Source contacts and the shot (pose, camera take,
 * environment) are not rewritten. The change is an override list.
 */
export const changeContactEffector = (project: Project, change: EffectorChange): EditOutcome => {
  const read = readPreview(project, change.shotId);
  if ("error" in read) return read;
  const { shot, preview } = read;
  const subject = resolveSubjectByName(project.worlds, shot, change.subjectRef, change.locale);
  if ("error" in subject) return subject;
  const source = preview.contacts.find((contact) => contact.contactId === change.contactId);
  if (!source) return { error: "접촉 이벤트를 찾지 못했습니다." };
  const onA = source.a.subjectId === subject.subjectId;
  const onB = source.b.subjectId === subject.subjectId;
  if (!onA && !onB) return { error: "이 접촉에 그 대상이 없습니다." };
  const resolved = resolveContacts(preview).find((contact) => contact.contactId === change.contactId);
  const currentPart = onA ? resolved?.a.rigPart : resolved?.b.rigPart;
  if (currentPart === change.rigPart) return { changed: false, project };
  const sourcePart = onA ? source.a.rigPart : source.b.rigPart;
  const without = preview.overrides.filter((override) => override.contactId !== change.contactId);
  const nextOverrides =
    change.rigPart === sourcePart
      ? without
      : [
          ...without,
          contactEffectorOverrideSchema.parse({
            contactId: change.contactId,
            worldAssetId: subject.worldAssetId,
            subjectId: subject.subjectId,
            rigPart: change.rigPart,
          }),
        ];
  return {
    changed: true,
    previous: preview.overrides,
    project: writeOverrides(project, preview, nextOverrides),
  };
};

/** Replace the override list. Used by undo. Source contacts and the shot stay put. */
export const setInteractionOverrides = (
  project: Project,
  shotId: string,
  overrides: ContactEffectorOverride[],
): EditOutcome => {
  const read = readPreview(project, shotId);
  if ("error" in read) return read;
  const parsed = contactEffectorOverrideSchema.array().safeParse(overrides);
  if (!parsed.success) return { error: "접촉 수정 기록을 읽지 못했습니다." };
  if (canonicalizeOverrides(read.preview.overrides) === canonicalizeOverrides(parsed.data)) {
    return { changed: false, project };
  }
  return {
    changed: true,
    previous: read.preview.overrides,
    project: writeOverrides(project, read.preview, parsed.data),
  };
};

const canonicalizeOverrides = (overrides: readonly ContactEffectorOverride[]): string =>
  JSON.stringify([...overrides].sort((left, right) => left.contactId.localeCompare(right.contactId)));
