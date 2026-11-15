import { z } from "zod";
import type { Project } from "../../domain/project/types";
import { mergeShotSubjects } from "../../domain/project/sceneLink";
import { WorldDomainError } from "../../domain/worlds/errors";
import { createPersistentIdFactory } from "../../domain/worlds/ids";
import { importRiggedActor, type RiggedActorImportSource } from "../../domain/worlds/riggedActorImport";
import { sceneStateSchema, type SceneState } from "../../domain/worlds/sceneState";
import type { CommandResult, DomainCommand, DomainEvent } from "./types";

const event = (type: DomainEvent["type"], payload: Record<string, unknown>, timestamp: string): DomainEvent => ({
  type,
  timestamp,
  payload,
});

const axisSchema = z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]);

const sourceSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
  sourcePath: z.string().min(1),
  nodeName: z.string().min(1),
  bones: z.array(z.object({ name: z.string() })),
  label: z.string().min(1),
  restTranslation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  restRotation: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]).optional(),
  restScale: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  sourceAxes: z.object({
    coordinateSystem: z.enum(["Y_UP", "Z_UP"]).optional(),
    upAxis: z.enum(["Y", "Z"]).optional(),
    handedness: z.enum(["right", "left"]).optional(),
    frontAxis: axisSchema.optional(),
    unitScaleMeters: z.number().finite().positive().optional(),
    metersPerUnit: z.number().finite().positive().optional(),
  }).optional(),
  legacySubjectId: z.string().optional(),
  shotId: z.string().optional(),
  legacyAssetId: z.string().optional(),
  gender: z.enum(["neutral", "male", "female"]).optional(),
  betas: z.array(z.number().finite()).optional(),
});

const fail = (
  project: Project,
  command: DomainCommand,
  reason: string,
): { project: Project; result: CommandResult } => ({
  project,
  result: { ok: false, command, events: [], reason },
});

const sceneForImport = (scene: SceneState, project: Project, worldId: string, source: RiggedActorImportSource, timestamp: string): SceneState => {
  if (scene.revisions[source.revisionId]) return scene;
  const shots = Object.values(project.shots ?? {}).filter((shot) => shot.environment?.worldId === worldId);
  return mergeShotSubjects(scene, shots, timestamp);
};

/**
 * Import one rigged actor into the world scene.
 * The inverse restores the previous scene, so undo does not tombstone the id and redo does not mint another.
 * Unmapped bones stay on the `RiggedActorImported` event. They do not fail the command.
 * Does not mark graph nodes dirty and does not touch render cache.
 */
export const applyImportRiggedActor = (
  project: Project,
  command: Extract<DomainCommand, { type: "IMPORT_RIGGED_ACTOR" }>,
  timestamp: string,
): { project: Project; result: CommandResult } => {
  const parsed = sourceSchema.safeParse(command.source);
  if (!parsed.success) return fail(project, command, "Rigged actor source is invalid.");
  const original = project.sceneStates?.[command.worldId];
  if (!original) return fail(project, command, "Scene not found.");
  if (parsed.data.bones.length === 0) {
    return { project, result: { ok: true, command, events: [] } };
  }
  try {
    const scene = sceneForImport(original, project, command.worldId, parsed.data, timestamp);
    const imported = importRiggedActor(scene, parsed.data, createPersistentIdFactory());
    const changed = imported.scene !== original;
    const nextProject = changed
      ? { ...project, sceneStates: { ...project.sceneStates, [command.worldId]: imported.scene } }
      : project;
    return {
      project: nextProject,
      result: {
        ok: true,
        command,
        inverse: changed
          ? { type: "RESTORE_SCENE_STATE", worldId: command.worldId, scene: original }
          : undefined,
        events: [event("RiggedActorImported", {
          worldId: command.worldId,
          actorId: imported.actor.id,
          minted: imported.minted,
          diagnostics: imported.diagnostics,
          sourceAxes: parsed.data.sourceAxes ?? {},
        }, timestamp)],
      },
    };
  } catch (error) {
    if (error instanceof WorldDomainError) return fail(project, command, error.message);
    return fail(project, command, "Rigged actor import failed.");
  }
};

/**
 * Put a scene snapshot back. Used as the inverse of `IMPORT_RIGGED_ACTOR`.
 * The inverse of this command is the scene that was current, so redo keeps the minted actor id.
 */
export const applyRestoreSceneState = (
  project: Project,
  command: Extract<DomainCommand, { type: "RESTORE_SCENE_STATE" }>,
): { project: Project; result: CommandResult } => {
  const current = project.sceneStates?.[command.worldId];
  if (!current) return fail(project, command, "Scene not found.");
  const parsed = sceneStateSchema.safeParse(command.scene);
  if (!parsed.success || parsed.data.worldId !== command.worldId) {
    return fail(project, command, "Scene state could not be restored.");
  }
  return {
    project: { ...project, sceneStates: { ...project.sceneStates, [command.worldId]: parsed.data } },
    result: {
      ok: true,
      command,
      inverse: { type: "RESTORE_SCENE_STATE", worldId: command.worldId, scene: current },
      events: [],
    },
  };
};
