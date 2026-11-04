import type { TargetMatch } from "../worlds/query";
import type { ContactEffector } from "./shotScene";
import type { Shot } from "./shot";
import type { ShotEditLocality, ShotOverrideEvent, ShotRevision } from "./shotEditorial";
import type { ShotScene } from "./shotScene";

const normalizeLabel = (value: string): string => value.trim().toLowerCase();

const EFFECTOR_NAMES: Record<string, ContactEffector> = {
  left_hand: "left_hand",
  "left hand": "left_hand",
  왼손: "left_hand",
  right_hand: "right_hand",
  "right hand": "right_hand",
  오른손: "right_hand",
  left_foot: "left_foot",
  right_foot: "right_foot",
  head: "head",
  pelvis: "pelvis",
};

/** Map an explicit effector token. Does not consult TargetResolver — hands are not world assets. */
export const parseContactEffector = (value: string): ContactEffector | undefined =>
  EFFECTOR_NAMES[normalizeLabel(value)] ?? EFFECTOR_NAMES[value.trim()];

/**
 * Bind a TargetResolver character match to a scene actor label.
 * Exact display-name match only. Side effect: none. Does not read or write the dependency graph.
 */
export const actorIdForTargetMatches = (
  scene: ShotScene,
  matches: readonly TargetMatch[],
  refText: string,
  worldId?: string,
): string | undefined => {
  const exact = matches
    .filter(
      (match) =>
        match.kind === "character" &&
        (worldId === undefined || match.assetId === worldId) &&
        normalizeLabel(match.displayName) === normalizeLabel(refText),
    )
    .sort((left, right) => right.score - left.score)[0];
  if (!exact) {
    return undefined;
  }
  return Object.values(scene.actors).find((actor) => normalizeLabel(actor.label) === normalizeLabel(exact.displayName))
    ?.id;
};

const cloneEvent = (event: ShotOverrideEvent): ShotOverrideEvent => ({
  ...event,
  locality: {
    preserve: [...event.locality.preserve],
    recompute: [...event.locality.recompute],
  },
});

const headRevision = (shot: Shot): ShotRevision | undefined =>
  shot.revisions.find((revision) => revision.id === shot.headRevisionId);

const nextRevision = (
  shot: Shot,
  overrides: ShotOverrideEvent[],
  revisionId: string,
  timestamp: string,
): { shot: Shot } | { error: string } => {
  const head = headRevision(shot);
  if (!head) {
    return { error: "Shot revision was not found." };
  }
  const copied = overrides.map(cloneEvent);
  const revision: ShotRevision = {
    id: revisionId,
    number: Math.max(...shot.revisions.map((item) => item.number)) + 1,
    parentId: head.id,
    createdAt: timestamp,
    assetRefs: head.assetRefs.map((ref) => ({ ...ref })),
    overrides: copied.map(cloneEvent),
  };
  return {
    shot: {
      ...shot,
      overrides: copied,
      revisions: [...shot.revisions, revision],
      headRevisionId: revision.id,
    },
  };
};

export type ShotEditResult = { ok: true; shot: Shot } | { ok: false; error: string };

export interface ShotEditorialSnapshot {
  overrides: ShotOverrideEvent[];
  revisions: ShotRevision[];
  headRevisionId: string;
}

/** Copy the editable stack. Scene and approvals stay on the shot and are not part of the snapshot. */
export const captureShotEditorial = (shot: Shot): ShotEditorialSnapshot => ({
  headRevisionId: shot.headRevisionId,
  overrides: shot.overrides.map(cloneEvent),
  revisions: shot.revisions.map((revision) => ({
    ...revision,
    assetRefs: revision.assetRefs.map((ref) => ({ ...ref })),
    overrides: revision.overrides.map(cloneEvent),
  })),
});

/** Restore a captured stack. Does not replace `scene` or `approvals`. */
export const restoreShotEditorial = (shot: Shot, snapshot: ShotEditorialSnapshot): Shot => ({
  ...shot,
  headRevisionId: snapshot.headRevisionId,
  overrides: snapshot.overrides.map(cloneEvent),
  revisions: snapshot.revisions.map((revision) => ({
    ...revision,
    assetRefs: revision.assetRefs.map((ref) => ({ ...ref })),
    overrides: revision.overrides.map(cloneEvent),
  })),
});

/**
 * Append one contact-effector override and a new shot revision.
 * Copies the previous asset pins. Does not mutate `shot` or its scene, and does not invalidate caches.
 */
export const addContactEffectorOverride = (
  shot: Shot,
  input: {
    actorId: string;
    targetActorId?: string;
    contactId: string;
    newEffector: ContactEffector;
    locality: ShotEditLocality;
    eventId: string;
    revisionId: string;
    timestamp: string;
  },
): ShotEditResult => {
  const contact = shot.scene.contacts[input.contactId];
  if (!contact) {
    return { ok: false, error: "Contact was not found." };
  }
  if (contact.actorId !== input.actorId) {
    return { ok: false, error: "That contact belongs to a different actor." };
  }
  if (shot.overrides.some((event) => event.id === input.eventId)) {
    return { ok: false, error: "Override already exists." };
  }
  const event: ShotOverrideEvent = {
    id: input.eventId,
    operation: "change_contact_effector",
    actorId: input.actorId,
    targetActorId: input.targetActorId,
    contactId: input.contactId,
    newEffector: input.newEffector,
    locality: {
      preserve: [...input.locality.preserve],
      recompute: [...input.locality.recompute],
    },
    createdAt: input.timestamp,
  };
  const appended = nextRevision(shot, [...shot.overrides, event], input.revisionId, input.timestamp);
  if ("error" in appended) {
    return { ok: false, error: appended.error };
  }
  return { ok: true, shot: appended.shot };
};

/**
 * Drop one override and record the shorter stack as a new revision.
 * Does not mutate the base scene. Does not delete older revisions.
 */
export const removeShotOverride = (
  shot: Shot,
  input: { overrideId: string; revisionId: string; timestamp: string },
): ShotEditResult => {
  if (!shot.overrides.some((event) => event.id === input.overrideId)) {
    return { ok: false, error: "Override was not found." };
  }
  const appended = nextRevision(
    shot,
    shot.overrides.filter((event) => event.id !== input.overrideId),
    input.revisionId,
    input.timestamp,
  );
  if ("error" in appended) {
    return { ok: false, error: appended.error };
  }
  return { ok: true, shot: appended.shot };
};

/**
 * Replace the effector (and optional locality) on an existing override.
 * The previous revision keeps the old event. The base scene is not written.
 */
export const updateShotOverride = (
  shot: Shot,
  input: {
    overrideId: string;
    newEffector?: ContactEffector;
    locality?: ShotEditLocality;
    revisionId: string;
    timestamp: string;
  },
): ShotEditResult => {
  const current = shot.overrides.find((event) => event.id === input.overrideId);
  if (!current) {
    return { ok: false, error: "Override was not found." };
  }
  const replacement: ShotOverrideEvent = {
    ...cloneEvent(current),
    newEffector: input.newEffector ?? current.newEffector,
    locality: input.locality
      ? { preserve: [...input.locality.preserve], recompute: [...input.locality.recompute] }
      : cloneEvent(current).locality,
    createdAt: input.timestamp,
  };
  const appended = nextRevision(
    shot,
    shot.overrides.map((event) => (event.id === input.overrideId ? replacement : event)),
    input.revisionId,
    input.timestamp,
  );
  if ("error" in appended) {
    return { ok: false, error: appended.error };
  }
  return { ok: true, shot: appended.shot };
};

/**
 * Point the shot at an existing revision and restore that revision's override stack.
 * Later revisions stay in the list so undo can move the head back. Scene and approvals are untouched.
 */
export const revertShotToRevision = (shot: Shot, revisionId: string): ShotEditResult => {
  const target = shot.revisions.find((revision) => revision.id === revisionId);
  if (!target) {
    return { ok: false, error: "Shot revision was not found." };
  }
  return {
    ok: true,
    shot: {
      ...shot,
      headRevisionId: target.id,
      overrides: target.overrides.map(cloneEvent),
    },
  };
};

/**
 * Apply the override stack to a copy of the scene.
 * Only `change_contact_effector` is interpreted, and it writes the contact effector alone.
 * Side effect: none. Does not hash slices and does not mark caches dirty — Graph owns that.
 */
export const resolveShotScene = (scene: ShotScene, overrides: readonly ShotOverrideEvent[]): ShotScene =>
  overrides.reduce((current, event) => {
    if (event.operation !== "change_contact_effector") {
      return current;
    }
    const contact = current.contacts[event.contactId];
    if (!contact || contact.actorId !== event.actorId) {
      return current;
    }
    return {
      ...current,
      contacts: {
        ...current.contacts,
        [contact.id]: { ...contact, effector: event.newEffector },
      },
    };
  }, scene);
