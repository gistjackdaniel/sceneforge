import type { Project } from "../../domain/project/types";
import { createPersistentId } from "../../domain/timeline/persistentId";
import type { Shot } from "../../domain/timeline/shot";
import {
  actorIdForTargetMatches,
  addContactEffectorOverride,
  captureShotEditorial,
  parseContactEffector,
  removeShotOverride,
  restoreShotEditorial,
  revertShotToRevision,
  updateShotOverride,
} from "../../domain/timeline/shotEdit";
import { createWorldTargetResolver } from "../../domain/worlds/query";
import type { CommandResult, DomainCommand, DomainEvent } from "./types";

const event = (type: DomainEvent["type"], payload: Record<string, unknown>, timestamp: string): DomainEvent => ({
  type,
  timestamp,
  payload,
});

const replaceShot = (project: Project, shot: Shot): Project => ({
  ...project,
  shots: { ...(project.shots ?? {}), [shot.id]: shot },
});

type ShotEditorialCommand = Extract<
  DomainCommand,
  { type: "ADD_SHOT_OVERRIDE" | "REMOVE_SHOT_OVERRIDE" | "UPDATE_SHOT_OVERRIDE" | "REVERT_SHOT_REVISION" }
>;

/**
 * Undoable shot override edits. The inverse is the same command with `restore` set to the previous stack.
 * Does not mark dependency caches dirty and does not replace `shot.scene`.
 */
export const applyShotEditorialCommand = (
  project: Project,
  command: ShotEditorialCommand,
  timestamp: string,
): { project: Project; result: CommandResult } => {
  const fail = (reason: string): { project: Project; result: CommandResult } => ({
    project,
    result: { ok: false, command, events: [], reason },
  });
  const shot = project.shots?.[command.shotId];
  if (!shot || shot.id !== command.shotId) {
    return fail("Shot was not found.");
  }

  if (command.restore) {
    const previous = captureShotEditorial(shot);
    return {
      project: replaceShot(project, restoreShotEditorial(shot, command.restore)),
      result: {
        ok: true,
        command,
        inverse: { ...command, restore: previous },
        events: [event("ShotOverrideChanged", { shotId: shot.id, restored: true }, timestamp)],
      },
    };
  }

  const planned = plan(project, shot, command, timestamp);
  if (!planned.ok) {
    return fail(planned.error);
  }
  return {
    project: replaceShot(project, planned.shot),
    result: {
      ok: true,
      command,
      inverse: { ...command, restore: captureShotEditorial(shot) },
      events: [event("ShotOverrideChanged", { shotId: shot.id, operation: command.type }, timestamp)],
    },
  };
};

const plan = (
  project: Project,
  shot: Shot,
  command: ShotEditorialCommand,
  timestamp: string,
): { ok: true; shot: Shot } | { ok: false; error: string } => {
  switch (command.type) {
    case "ADD_SHOT_OVERRIDE": {
      const clip = project.clips[shot.clipId];
      if (!clip) {
        return { ok: false, error: "Clip was not found." };
      }
      const effector = parseContactEffector(command.newEffector);
      if (!effector) {
        return { ok: false, error: "Effector was not recognized." };
      }
      const worldId = clip.linkedWorldId;
      const matchesFor = (refText: string) =>
        createWorldTargetResolver(project.worlds).resolve(refText, {
          selectionIds: worldId ? [worldId] : [],
          locale: command.locale ?? "ko",
        });
      const actorId = actorIdForTargetMatches(shot.scene, matchesFor(command.actorRef), command.actorRef, worldId);
      if (!actorId) {
        return { ok: false, error: "Actor was not found." };
      }
      const targetActorId = command.targetActorRef
        ? actorIdForTargetMatches(shot.scene, matchesFor(command.targetActorRef), command.targetActorRef, worldId)
        : undefined;
      if (command.targetActorRef && !targetActorId) {
        return { ok: false, error: "Actor was not found." };
      }
      return addContactEffectorOverride(shot, {
        actorId,
        targetActorId,
        contactId: command.contactId,
        newEffector: effector,
        locality: command.locality,
        eventId: createPersistentId("sev"),
        revisionId: createPersistentId("shr"),
        timestamp,
      });
    }
    case "REMOVE_SHOT_OVERRIDE":
      return removeShotOverride(shot, {
        overrideId: command.overrideId,
        revisionId: createPersistentId("shr"),
        timestamp,
      });
    case "UPDATE_SHOT_OVERRIDE": {
      const effector = command.newEffector ? parseContactEffector(command.newEffector) : undefined;
      if (command.newEffector && !effector) {
        return { ok: false, error: "Effector was not recognized." };
      }
      return updateShotOverride(shot, {
        overrideId: command.overrideId,
        newEffector: effector,
        locality: command.locality,
        revisionId: createPersistentId("shr"),
        timestamp,
      });
    }
    case "REVERT_SHOT_REVISION":
      return revertShotToRevision(shot, command.revisionId);
    default:
      return { ok: false, error: "Shot command was not recognized." };
  }
};
