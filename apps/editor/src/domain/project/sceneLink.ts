import { z } from "zod";
import type { PosedSubject, Shot } from "../shot/types";
import { createWorldTargetResolver, type TargetResolver } from "../worlds/query";
import { sourceAxesFromWorldAsset, type SourceAxes } from "../worlds/coordinates";
import { eulerToQuaternion } from "../shot/eulerAdapter";
import { WorldDomainError } from "../worlds/errors";
import { persistentIdSchema } from "../worlds/ids";
import { migrateWorldToSceneState } from "../worlds/migrateInstances";
import {
  sceneStateSchema,
  type ActorInstance,
  type Asset,
  type AssetRevision,
  type ObjectInstance,
  type SceneState,
} from "../worlds/sceneState";
import type { Project } from "./types";
import type { WorldAsset } from "../worlds/types";

const NEUTRAL_BETAS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

const canonicalAxes = (): SourceAxes => sourceAxesFromWorldAsset({
  coordinateSystem: "Y_UP",
  unitScaleMeters: 1,
  handedness: "right",
  frontAxis: "+Z",
});

const createdAtOf = (project: Project): string => {
  const stamp = project.updatedAt || project.createdAt;
  return z.iso.datetime().safeParse(stamp).success ? stamp : "1970-01-01T00:00:00.000Z";
};

const posedSubjects = (shot: Shot): PosedSubject[] =>
  shot.subjects.filter((subject): subject is PosedSubject => subject.kind !== "light" && Boolean(subject.instanceId && subject.assetRef));

/**
 * Add shot subjects that the scene does not already contain.
 * An existing instance keeps its label, pin, rest pose, and attachments.
 * Shot motion stays on the shot. `motionMode: "dynamic"` is not inferred from sparse keys.
 */
export const mergeShotSubjects = (scene: SceneState, shots: readonly Shot[], createdAt: string): SceneState => {
  const assets = { ...scene.assets };
  const revisions = { ...scene.revisions };
  const actors = { ...scene.actors };
  const objects = { ...scene.objects };
  const axes = canonicalAxes();

  for (const shot of shots) {
    for (const subject of posedSubjects(shot)) {
      const pin = subject.assetRef;
      const instanceId = subject.instanceId;
      if (!pin || !instanceId) continue;
      if (!revisions[pin.revisionId]) {
        const revision: AssetRevision = {
          revisionId: pin.revisionId,
          assetId: pin.assetId,
          revision: subject.assetVersion > 0 ? subject.assetVersion : 1,
          contentHash: `legacy-fingerprint:${pin.assetId}:${subject.assetVersion}:${subject.uri}`,
          uri: subject.uri,
          sourceAxes: axes,
          createdAt,
          legacy: { assetRecordId: subject.assetId },
        };
        revisions[pin.revisionId] = revision;
      }
      const existingAsset = assets[pin.assetId];
      if (!existingAsset) {
        const asset: Asset = {
          id: pin.assetId,
          kind: subject.kind === "human" ? "character" : "prop",
          name: subject.name,
          aliases: [],
          localizedNames: {},
          headRevisionId: pin.revisionId,
          revisionIds: [pin.revisionId],
        };
        assets[pin.assetId] = asset;
      } else if (!existingAsset.revisionIds.includes(pin.revisionId)) {
        const ordered = [...existingAsset.revisionIds, pin.revisionId].sort(
          (left, right) => (revisions[left]?.revision ?? 0) - (revisions[right]?.revision ?? 0),
        );
        const head = ordered[ordered.length - 1] ?? existingAsset.headRevisionId;
        assets[pin.assetId] = { ...existingAsset, revisionIds: ordered, headRevisionId: head };
      }
      if (actors[instanceId] || objects[instanceId]) continue;
      const rotation = eulerToQuaternion(subject.placement.rotationEuler);
      const rest = {
        translation: [...subject.placement.position] as [number, number, number],
        rotation: [...rotation] as [number, number, number, number],
        scale: [...subject.placement.scale] as [number, number, number],
      };
      if (subject.kind === "human") {
        const actor: ActorInstance = {
          id: instanceId,
          type: "actor",
          label: subject.name,
          aliases: [],
          localizedNames: {},
          assetRef: pin,
          restTransform: rest,
          legacyRefs: subject.legacyRefs ?? [],
          ...(subject.clonedFrom ? { clonedFrom: subject.clonedFrom } : {}),
          skeleton: { model: "smplx", gender: "neutral", betas: [...NEUTRAL_BETAS] },
        };
        actors[instanceId] = actor;
      } else {
        const object: ObjectInstance = {
          id: instanceId,
          type: "object",
          role: "prop",
          label: subject.name,
          aliases: [],
          localizedNames: {},
          assetRef: pin,
          restTransform: rest,
          legacyRefs: subject.legacyRefs ?? [],
          ...(subject.clonedFrom ? { clonedFrom: subject.clonedFrom } : {}),
          motionMode: subject.motion.channel === "explicit" ? "keyframed" : "static",
          attachments: [],
        };
        objects[instanceId] = object;
      }
    }
  }

  const parsed = sceneStateSchema.safeParse({ ...scene, assets, revisions, actors, objects });
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new WorldDomainError(
      "invalid_scene",
      path.length > 0 ? `Shot subjects could not join the scene (${path}).` : "Shot subjects could not join the scene.",
    );
  }
  return parsed.data;
};

const sceneForWorld = (project: Project, world: WorldAsset, shots: Shot[], createdAt: string): SceneState | undefined => {
  if (!persistentIdSchema.safeParse(world.id).success) return undefined;
  const saved = project.sceneStates?.[world.id];
  const parsed = saved ? sceneStateSchema.safeParse(saved) : undefined;
  const base = parsed?.success ? parsed.data : migrateWorldToSceneState(world);
  return mergeShotSubjects(base, shots, createdAt);
};

/**
 * Attach one scene per world and the shot subjects that name that world.
 * A scene that already validates is kept, then missing instances are added.
 */
export const attachSceneStates = <T extends Project>(project: T): T => {
  const shots = Object.values(project.shots ?? {});
  const createdAt = createdAtOf(project);
  const sceneStates: Record<string, SceneState> = {};
  for (const world of Object.values(project.worlds ?? {})) {
    const scene = sceneForWorld(project, world, shots.filter((shot) => shot.environment?.worldId === world.id), createdAt);
    if (scene) sceneStates[world.id] = scene;
  }
  return { ...project, sceneStates };
};

/** Resolver for a loaded project. Existing callers can still pass worlds alone. */
export const targetResolverForProject = (
  project: Pick<Project, "worlds" | "sceneStates">,
): TargetResolver => createWorldTargetResolver(project.worlds, project.sceneStates);
