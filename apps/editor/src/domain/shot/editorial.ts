import { z } from "zod";
import { resolveRigPart, rigPartSchema } from "../worlds/sceneState";
import type { Shot, ShotAssetRef, ShotCommand, ShotOverrideEvent, ShotRevision, Subject, SubjectId } from "./types";

const brand = <T extends string>(value: string) => value as T;

export const shotAssetRefSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const shotContactSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  targetActorId: z.string().min(1).optional(),
  effector: rigPartSchema,
});

export const shotOverrideEventSchema = z.object({
  id: z.string().min(1),
  operation: z.literal("change_contact_effector"),
  contactId: z.string().min(1),
  actorId: z.string().min(1),
  effector: rigPartSchema,
  preserve: z.array(z.string()),
  recompute: z.array(z.string()),
});

export const shotRevisionSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  overrides: z.array(shotOverrideEventSchema),
  assetRefs: z.array(shotAssetRefSchema),
});

export const shotApprovalSchema = z.object({
  revisionId: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  at: z.string().min(1).optional(),
});

export type ShotEditorialCommand = Extract<
  ShotCommand,
  { type: "ADD_SHOT_OVERRIDE" | "UPDATE_SHOT_OVERRIDE" | "REMOVE_SHOT_OVERRIDE" | "REVERT_SHOT_REVISION" }
>;

export type EditorialEdit =
  | { ok: true; shot: Shot; changed: boolean }
  | { ok: false; reason: string };

type ActorMatch = {
  kind: string;
  displayName: string;
  instanceId?: string;
  elementId?: string;
};

/**
 * Match a resolver hit to a shot subject.
 * Exact display name wins. The subject id may be the world instance id or the element id.
 * Does not copy camera, subjects, or the set.
 */
export const subjectForActorRef = (
  shot: Shot,
  matches: readonly ActorMatch[],
  refText: string,
): Subject | undefined => {
  const characters = matches.filter((match) => match.kind === "character");
  const exact = characters.filter((match) => match.displayName === refText);
  const pool = exact.length > 0 ? exact : characters.length === 1 ? characters : [];
  const found = new Set<Subject>();
  for (const chosen of pool) {
    const subject = shot.subjects.find((item) =>
      item.id === chosen.instanceId
      || item.id === chosen.elementId
      || item.name === chosen.displayName,
    );
    if (subject) found.add(subject);
  }
  return found.size === 1 ? [...found][0] : undefined;
};

/** Interpreted contacts. Base contact objects stay in place when the effector is unchanged. */
export const resolveShotContacts = (shot: Shot) => {
  const events = shot.overrides ?? [];
  return (shot.contacts ?? []).map((contact) => {
    const applied = [...events].reverse().find((event) => event.contactId === contact.id);
    if (!applied || applied.effector === contact.effector) return contact;
    return { ...contact, effector: applied.effector };
  });
};

const pinsFromSubjects = (shot: Shot): ShotAssetRef[] =>
  shot.subjects.map((subject) => ({
    assetId: subject.assetId,
    revisionId: `${subject.assetId}@${subject.assetVersion}`,
  }));

const copyPins = (shot: Shot): ShotAssetRef[] => {
  const head = (shot.revisions ?? []).find((revision) => revision.id === shot.headRevisionId);
  const source = head?.assetRefs ?? pinsFromSubjects(shot);
  return source.map((pin) => ({ assetId: pin.assetId, revisionId: pin.revisionId }));
};

const copyEvent = (event: ShotOverrideEvent): ShotOverrideEvent => ({
  ...event,
  preserve: [...event.preserve],
  recompute: [...event.recompute],
});

const withRevision = (
  shot: Shot,
  overrides: readonly ShotOverrideEvent[],
  now: string,
): Shot => {
  const revision: ShotRevision = {
    id: `shr_${shot.id}_${shot.revisions?.length ?? 0}`,
    parentId: shot.headRevisionId,
    createdAt: now,
    overrides: overrides.map(copyEvent),
    assetRefs: copyPins(shot),
  };
  const stored = shotRevisionSchema.parse(revision);
  return {
    ...shot,
    overrides: stored.overrides.map((event) => ({
      ...event,
      actorId: brand<SubjectId>(event.actorId),
    })),
    revisions: [...(shot.revisions ?? []), { ...stored, overrides: stored.overrides.map((event) => ({
      ...event,
      actorId: brand<SubjectId>(event.actorId),
    })) }],
    headRevisionId: stored.id,
  };
};

/**
 * Stack a contact-effector edit on the shot.
 * Subjects, camera, environment, base contacts, and approvals are left in place.
 * The inverse is `REPLACE_SHOT` of the shot passed in.
 */
export const editShotEditorial = (shot: Shot, command: ShotEditorialCommand, now: string): EditorialEdit => {
  if (command.shotId !== shot.id) return { ok: false, reason: "Shot not found." };

  if (command.type === "REVERT_SHOT_REVISION") {
    const revision = (shot.revisions ?? []).find((item) => item.id === command.revisionId);
    if (!revision) return { ok: false, reason: "Revision not found." };
    if (shot.headRevisionId === revision.id) return { ok: true, shot, changed: false };
    return {
      ok: true,
      changed: true,
      shot: {
        ...shot,
        overrides: revision.overrides.map(copyEvent),
        headRevisionId: revision.id,
      },
    };
  }

  if (command.type === "REMOVE_SHOT_OVERRIDE") {
    const current = shot.overrides ?? [];
    if (!current.some((event) => event.id === command.eventId)) return { ok: false, reason: "Override not found." };
    return {
      ok: true,
      changed: true,
      shot: withRevision(shot, current.filter((event) => event.id !== command.eventId), now),
    };
  }

  if (command.type === "UPDATE_SHOT_OVERRIDE") {
    const current = shot.overrides ?? [];
    const event = current.find((item) => item.id === command.eventId);
    if (!event) return { ok: false, reason: "Override not found." };
    const part = resolveRigPart(command.newEffector);
    if (!part) return { ok: false, reason: "Effector is not a rig part." };
    if (event.effector === part.rigPart) return { ok: true, shot, changed: false };
    const overrides = current.map((item) => item.id === event.id ? { ...item, effector: part.rigPart } : item);
    return { ok: true, changed: true, shot: withRevision(shot, overrides, now) };
  }

  const contact = (shot.contacts ?? []).find((item) => item.id === command.contactId);
  if (!contact) return { ok: false, reason: "Contact not found." };
  if (contact.actorId !== command.actorSubjectId) return { ok: false, reason: "Contact actor does not match." };
  if (command.targetSubjectId && contact.targetActorId !== command.targetSubjectId) {
    return { ok: false, reason: "Contact target does not match." };
  }
  const actor = shot.subjects.find((subject) => subject.id === command.actorSubjectId);
  if (!actor || actor.kind !== "human") return { ok: false, reason: "Actor not found." };
  const part = resolveRigPart(command.newEffector);
  if (!part) return { ok: false, reason: "Effector is not a rig part." };
  const resolved = resolveShotContacts(shot).find((item) => item.id === contact.id);
  if (resolved?.effector === part.rigPart) return { ok: true, shot, changed: false };
  const event = shotOverrideEventSchema.parse({
    id: `sev_${shot.id}_${shot.overrides?.length ?? 0}`,
    operation: "change_contact_effector",
    contactId: contact.id,
    actorId: command.actorSubjectId,
    effector: part.rigPart,
    preserve: [...command.preserve],
    recompute: [...command.recompute],
  });
  const stored: ShotOverrideEvent = { ...event, actorId: brand<SubjectId>(event.actorId) };
  return { ok: true, changed: true, shot: withRevision(shot, [...(shot.overrides ?? []), stored], now) };
};
