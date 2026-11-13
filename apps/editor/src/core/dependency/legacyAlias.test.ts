import { describe, expect, it } from "vitest";
import { rekeyCacheEntry } from "../cache/legacyLookup";
import { applyShotCommand, parseShot, shotId, subjectId, type Shot, type ShotCommand } from "../../domain/shot";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import { createMeshExampleWorld } from "../../domain/worlds/sampleWorlds";
import {
  createLegacyIdResolver,
  detectOutdatedOutputs,
  planRevisionScope,
  projectShotDependencies,
  recordComputedOutput,
  resolveLegacyId,
  type OutputProvenanceStore,
  type ShotDependencyNode,
} from "./index";
import { applyRevisionPlan } from "../cache/invalidation";

const ACT_A = "act_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SHOT = "shot-contact";
const PREVIOUS_TAKE = `take-${SHOT}-1`;
/** Same shape as Scene PR #34 `legacyCameraTakeId`, without importing that module. */
const sanitizeLegacyToken = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");
const CAM = `cam_legacy_${sanitizeLegacyToken(SHOT)}__${sanitizeLegacyToken(PREVIOUS_TAKE)}`;
const now = "2026-11-12T00:00:00.000Z";

const step = (shot: Shot, command: ShotCommand): Shot => {
  const edited = applyShotCommand(shot, command, now);
  if (!edited.ok) {
    throw new Error(edited.reason);
  }
  return edited.shot;
};

const stage = () => {
  const world = createMeshExampleWorld();
  let shot = parseShot({
    schemaVersion: 1,
    id: SHOT,
    name: "Contact",
    time: { fps: 25, durationFrames: 48, origin: "clip_local" },
    subjects: [],
    camera: {
      status: "empty",
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
      interpolation: "linear",
    },
    renders: [],
  });
  const id = shotId(shot.id);
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: "subject-A", name: "A", fileUri: "actors/a.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: "actor-b", name: "B", fileUri: "actors/b.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "object", id: "cup", name: "Cup", fileUri: "props/cup.glb" } });
  shot = step(shot, { type: "KEY_SUBJECT_POSE", shotId: id, subjectId: subjectId("subject-A"), key: { frame: 0, position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] } });
  shot = step(shot, { type: "KEY_SUBJECT_POSE", shotId: id, subjectId: subjectId("actor-b"), key: { frame: 0, position: [1, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] } });
  shot = step(shot, { type: "KEY_CAMERA", shotId: id, key: { frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 } });
  if (shot.camera.status !== "ready") {
    throw new Error("camera");
  }
  shot = parseShot({ ...shot, environment: { worldId: world.id } });
  if (shot.camera.status !== "ready" || shot.camera.takes[0].id !== PREVIOUS_TAKE) {
    throw new Error(shot.camera.status === "ready" ? shot.camera.takes[0].id : "camera");
  }
  return { world, shot, environment: environmentFromWorld(world) };
};

const project = (shot: Shot, worldId: string, world: ReturnType<typeof createMeshExampleWorld>, environment: ReturnType<typeof environmentFromWorld>) => {
  const graph = projectShotDependencies({
    shot,
    worlds: { [worldId]: world },
    environment,
    modelVersion: "video-0.1",
    seed: 3,
  });
  if (!graph.ok) {
    throw new Error(graph.message);
  }
  return graph;
};

const find = (nodes: ShotDependencyNode[], channel: ShotDependencyNode["channel"], unitId: string) => {
  const node = nodes.find((item) => item.channel === channel && item.unitId === unitId);
  if (!node) {
    throw new Error(`missing ${channel} ${unitId}`);
  }
  return node;
};

describe("legacy id cache alias", () => {
  it("hits the renamed root, background, and camera without changing the pass hash, then still limits B's contact recompute", () => {
    const { world, shot, environment } = stage();
    const before = project(shot, world.id, world, environment);
    const rootBefore = find(before.nodes, "root_motion", "subject-A");
    const roomBefore = before.nodes.find((node) => node.entity === "room");
    const cameraBefore = before.nodes.find((node) => node.entity === "camera_take");
    if (!roomBefore || !cameraBefore) {
      throw new Error("room or camera missing");
    }

    const migrated = parseShot({
      ...shot,
      subjects: shot.subjects.map((subject) => subject.id === "subject-A" ? { ...subject, id: ACT_A } : subject),
      camera: shot.camera.status === "ready"
        ? {
            ...shot.camera,
            selectedTakeId: CAM,
            takes: shot.camera.takes.map((take) => take.id === PREVIOUS_TAKE ? { ...take, id: CAM } : take),
          }
        : shot.camera,
    });
    const after = project(migrated, world.id, world, environment);
    const rootAfter = find(after.nodes, "root_motion", ACT_A);
    const roomAfter = after.nodes.find((node) => node.entity === "room");
    const cameraAfter = after.nodes.find((node) => node.entity === "camera_take" && node.unitId === CAM);
    if (!roomAfter || !cameraAfter) {
      throw new Error("migrated room or camera missing");
    }

    const previousTake = shot.camera.status === "ready" ? shot.camera.takes[0] : undefined;
    if (!previousTake) {
      throw new Error("camera");
    }
    const migratedTake = {
      schemaVersion: 1 as const,
      id: CAM,
      name: previousTake.name,
      source: previousTake.source,
      keys: previousTake.keys,
      createdAt: previousTake.createdAt,
      samples: [] as const,
      calibration: {
        calibrationId: "cal-legacy",
        arFramework: "viewport" as const,
        scale: 1,
        rotation: [0, 0, 0, 1] as const,
        translation: [0, 0, 0] as const,
        method: "identity" as const,
        createdAt: now,
      },
      trackingEvents: [] as const,
      mapping: {
        mode: "one_to_one" as const,
        translationGain: [1, 1, 1] as const,
        rotationGain: 1,
        smoothing: 0,
        timeScale: 1,
        timeOffsetFrames: 0,
      },
      legacyRefs: [{ kind: "camera_take" as const, shotId: shot.id, takeId: PREVIOUS_TAKE }],
      rotationStorage: "quaternion_xyzw" as const,
    };
    const carriers = [
      { id: ACT_A, legacyRefs: [{ kind: "shot_subject", shotId: shot.id, subjectId: "subject-A" }] },
      migratedTake,
    ];
    const resolver = createLegacyIdResolver(carriers);
    expect(CAM).toBe("cam_legacy_shot_contact__take_shot_contact_1");
    expect(resolver.resolveLegacyId("subject-A")).toBe(ACT_A);
    expect(resolver.resolveLegacyId(PREVIOUS_TAKE)).toBe(CAM);
    expect(resolver.resolveLegacyId(shot.id)).toBeUndefined();

    for (const [previous, next] of [
      [rootBefore, rootAfter],
      [roomBefore, roomAfter],
      [cameraBefore, cameraAfter],
    ] as const) {
      const looked = rekeyCacheEntry(before.caches, next.output.cacheId, resolver);
      expect(looked.hit).toBe(true);
      expect(looked.entry?.dependencyHash).toBe(previous.hash);
      expect(looked.entry?.status).toBe("valid");
      expect(looked.entry?.invalidatedByNodeIds).toEqual([]);
      expect(next.hash).toBe(previous.hash);
      expect(JSON.stringify(next.value)).not.toContain(ACT_A);
      expect(JSON.stringify(next.value)).not.toContain("subject-A");
      expect(JSON.stringify(next.value)).not.toContain(CAM);
      expect(JSON.stringify(next.value)).not.toContain(PREVIOUS_TAKE);
    }

    const actorB = migrated.subjects.find((subject) => subject.name === "B");
    if (!actorB) {
      throw new Error("B missing");
    }
    const edited = step(migrated, {
      type: "KEY_SUBJECT_POSE",
      shotId: migrated.id,
      subjectId: actorB.id,
      key: { frame: 0, position: [1, 0, 0], rotationEuler: [0, 0.4, 0], scale: [1, 1, 1] },
    });
    const recomputed = project(edited, world.id, world, environment);
    let store: OutputProvenanceStore = {};
    after.outputs.forEach((output) => {
      const recorded = recordComputedOutput(store, output);
      expect(recorded.ok).toBe(true);
      if (recorded.ok) {
        store = recorded.store;
      }
    });
    const detection = detectOutdatedOutputs(
      store,
      Object.fromEntries(recomputed.outputs.map((output) => [output.outputId, output.fingerprint])),
    );
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    const contactB = find(after.nodes, "contact_hand", actorB.id);
    const downstreamB = find(after.nodes, "contact_hand_downstream", actorB.id);
    expect(detection.outdated.map((item) => item.outputId).sort()).toEqual(
      [contactB.output.outputId, downstreamB.output.outputId].sort(),
    );
    const plan = planRevisionScope(
      {
        shotId: migrated.id,
        operation: "edit_contact_hand_pose",
        preserve: ["camera", "room/background", { kind: "motion", actor_id: ACT_A }, { kind: "root_motion", actor_id: ACT_A }],
        recompute: [{ kind: "motion", actor_id: actorB.id }],
      },
      { outputs: after.outputs, downstreamByNodeId: after.downstreamByNodeId },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const contactNode = after.nodes.find((node) => node.output.outputId === contactB.output.outputId);
    expect(contactNode?.output.selector).toMatchObject({ actorId: actorB.id });
    expect(plan.invalidateOutputIds).toContain(downstreamB.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(rootAfter.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(roomAfter.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(cameraAfter.output.outputId);
    const contactA = find(after.nodes, "contact_hand", ACT_A);
    expect(plan.invalidateOutputIds).not.toContain(contactA.output.outputId);
    const applied = applyRevisionPlan(after.caches, plan, "t1");
    expect(applied.caches[rootAfter.output.cacheId]).toBe(after.caches[rootAfter.output.cacheId]);
    expect(applied.caches[cameraAfter.output.cacheId]?.dependencyHash).toBe(cameraBefore.hash);
    expect(recomputed.nodes.find((node) => node.output.outputId === rootAfter.output.outputId)?.hash).toBe(rootBefore.hash);
  });

  it("misses a legacy id that has no mapping", () => {
    const carriers = [{ id: ACT_A, legacyRefs: [{ kind: "shot_subject", shotId: "shot-contact", subjectId: "subject-A" }] }];
    expect(resolveLegacyId("subject-Z", carriers)).toBeUndefined();
    expect(resolveLegacyId("subject-A", carriers)).toBe(ACT_A);
    const cache = {
      "cache:pose:subject-A:root_motion": {
        id: "cache:pose:subject-A:root_motion",
        status: "valid" as const,
        dependencyHash: "hash-a",
        invalidatedByNodeIds: [] as string[],
      },
    };
    const resolver = createLegacyIdResolver(carriers);
    const missed = rekeyCacheEntry(cache, "cache:pose:subject-Z:root_motion", resolver);
    expect(missed.hit).toBe(false);
    expect(missed.via).toBe("miss");
    expect(missed.cache).toBe(cache);
    expect(missed.entry).toBeUndefined();
  });
});
