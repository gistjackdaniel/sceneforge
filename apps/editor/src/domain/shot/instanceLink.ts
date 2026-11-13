import { parseShot } from "./schema";
import type { PosedSubject, Shot, SubjectId } from "./types";
import { subjectId } from "./types";
import type { PersistentIdFactory } from "../worlds/ids";
import { persistentIdSchema, sanitizeLegacyToken } from "../worlds/ids";
import type { LegacyRef } from "../worlds/sceneState";

const fitPersistentId = (value: string): string => {
  if (persistentIdSchema.safeParse(value).success) return value;
  const body = sanitizeLegacyToken(value).replace(/^[^A-Za-z]+/, "");
  const clipped = body.slice(0, 100);
  const candidate = /^[A-Za-z]/.test(clipped) ? clipped : `id_${clipped || "legacy"}`;
  if (persistentIdSchema.safeParse(candidate).success) return candidate;
  return `id_${sanitizeLegacyToken(value).slice(0, 80) || "legacy"}`;
};

/**
 * Persistent asset id for a shot asset id.
 * `primitive:box` and `file:<hash>` contain a colon, so they are not persistent ids.
 * They map to `ast_legacy_<sanitized>`. An id that is already persistent is kept.
 */
export const persistentAssetIdForLegacy = (legacyAssetId: string): string => {
  if (persistentIdSchema.safeParse(legacyAssetId).success) return legacyAssetId;
  return fitPersistentId(`ast_legacy_${sanitizeLegacyToken(legacyAssetId)}`);
};

/**
 * Integer `assetVersion` is the revision ordinal, starting at 1.
 * The pinned revision id is `rev_legacy_<sanitized asset id>__v<assetVersion>`.
 * Version 2 does not move a pin that still names `__v1`.
 */
export const revisionIdForAssetVersion = (legacyAssetId: string, assetVersion: number): string => {
  const version = Number.isInteger(assetVersion) && assetVersion > 0 ? assetVersion : 1;
  return fitPersistentId(`rev_legacy_${sanitizeLegacyToken(legacyAssetId)}__v${version}`);
};

/** Deterministic instance id for a shot subject that has none yet. Re-running returns the same id. */
export const legacyShotInstanceId = (
  kind: "human" | "object",
  shotId: string,
  subjectIdValue: string,
): string => {
  const prefix = kind === "human" ? "act_legacy_" : "obj_legacy_";
  return fitPersistentId(`${prefix}${sanitizeLegacyToken(shotId)}__${sanitizeLegacyToken(subjectIdValue)}`);
};

const refKey = (ref: LegacyRef): string => JSON.stringify(ref);

const withLegacy = (refs: readonly LegacyRef[] | undefined, extra: LegacyRef[]): LegacyRef[] => {
  const next = [...(refs ?? [])];
  const seen = new Set(next.map(refKey));
  for (const ref of extra) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(ref);
  }
  return next;
};

const persistent = (value: string | undefined): value is string =>
  typeof value === "string" && persistentIdSchema.safeParse(value).success;

/**
 * Fill a posed subject's instance id and asset pin.
 * An id that is already persistent is kept, so a second pass does not rename it.
 * `subject-*`, `primitive:*`, and `file:*` stay on the subject and are copied into `legacyRefs`.
 */
export const linkPosedSubject = (shotId: string, subject: PosedSubject): PosedSubject => {
  const instanceId = persistent(subject.instanceId)
    ? subject.instanceId
    : legacyShotInstanceId(subject.kind, shotId, subject.id);
  const assetId = subject.assetRef && persistent(subject.assetRef.assetId)
    ? subject.assetRef.assetId
    : persistentAssetIdForLegacy(subject.assetId);
  const revisionId = subject.assetRef && persistent(subject.assetRef.revisionId)
    ? subject.assetRef.revisionId
    : revisionIdForAssetVersion(subject.assetId, subject.assetVersion);
  return {
    ...subject,
    instanceId,
    assetRef: { assetId, revisionId },
    legacyRefs: withLegacy(subject.legacyRefs, [
      { kind: "shot_subject", shotId, subjectId: subject.id },
      { kind: "shot_asset", assetId: subject.assetId },
    ]),
  };
};

/** Link every posed subject. Lights are unchanged. Idempotent for an already linked shot. */
export const linkShotSubjects = (shot: Shot): Shot =>
  parseShot({
    ...shot,
    subjects: shot.subjects.map((subject) => subject.kind === "light" ? subject : linkPosedSubject(shot.id, subject)),
  });

/** Display name only. The subject id and the instance id stay. */
export const renamePosedSubject = (subject: PosedSubject, name: string): PosedSubject => {
  const label = name.trim();
  if (!label) throw new Error("Subject name is empty.");
  return { ...subject, name: label };
};

/**
 * Copy a posed subject onto a new subject id and a newly minted instance id.
 * The asset pin is copied. `clonedFrom` records the source instance id.
 */
export const clonePosedSubject = (
  subject: PosedSubject,
  shotId: string,
  ids: PersistentIdFactory,
  name?: string,
): PosedSubject => {
  const instanceId = ids.mint(subject.kind === "human" ? "act" : "obj");
  const cloned: PosedSubject = {
    ...subject,
    id: subjectId(`subject-${instanceId}`),
    name: name?.trim() || subject.name,
    instanceId,
    clonedFrom: subject.instanceId,
    legacyRefs: (subject.legacyRefs ?? []).filter((ref) => ref.kind === "shot_asset"),
  };
  return linkPosedSubject(shotId, cloned);
};

export const reservedInstanceIds = (shot: Shot): string[] =>
  shot.subjects.flatMap((subject) => subject.kind === "light" || !subject.instanceId ? [] : [subject.instanceId]);

export type { SubjectId };
