import { describe, expect, it } from "vitest";
import type { TimelineClip } from "../../domain/timeline/types";
import { applyShotCommand, parseShot, shotId, subjectId, type Shot, type ShotCommand } from "../../domain/shot";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import { createMeshExampleWorld } from "../../domain/worlds/sampleWorlds";
import { applyRevisionPlan } from "../cache/invalidation";
import {
  detectOutdatedOutputs,
  planRevisionScope,
  projectShotDependencies,
  recordComputedOutput,
  type OutputProvenanceStore,
  type ShotDependencyNode,
} from "./index";

const now = "2026-11-12T00:00:00.000Z";

const step = (shot: Shot, command: ShotCommand): Shot => {
  const edited = applyShotCommand(shot, command, now);
  if (!edited.ok) {
    throw new Error(edited.reason);
  }
  return edited.shot;
};

const poseKey = (
  frame: number,
  position: [number, number, number],
  rotationEuler: [number, number, number] = [0, 0, 0],
) => ({
  frame,
  position,
  rotationEuler,
  scale: [1, 1, 1] as [number, number, number],
});

const stage = () => {
  const world = createMeshExampleWorld();
  let shot = parseShot({
    schemaVersion: 1,
    id: "shot-contact",
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
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: "actor-a", name: "A", fileUri: "actors/a.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: "actor-b", name: "B", fileUri: "actors/b.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "object", id: "cup", name: "Cup", fileUri: "props/cup.glb" } });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId("actor-a"),
    key: poseKey(0, [0, 0, 0]),
  });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId("actor-a"),
    key: poseKey(24, [0.2, 0, 0.4]),
  });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId("actor-b"),
    key: poseKey(0, [1, 0, 0]),
  });
  shot = step(shot, {
    type: "KEY_CAMERA",
    shotId: id,
    key: { frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
  });
  shot = step(shot, {
    type: "KEY_CAMERA",
    shotId: id,
    key: { frame: 24, position: [0.4, 1.6, 3.5], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
  });
  shot = parseShot({ ...shot, environment: { worldId: world.id } });
  return { world, shot, environment: environmentFromWorld(world) };
};

const findNode = (
  nodes: ShotDependencyNode[],
  channel: ShotDependencyNode["channel"],
  unitId: string,
): ShotDependencyNode => {
  const node = nodes.find((item) => item.channel === channel && item.unitId === unitId);
  if (!node) {
    throw new Error(`missing ${channel} ${unitId}`);
  }
  return node;
};

describe("shot record dependency cache", () => {
  it("recomputes only B's contact-hand downstream and keeps camera, room, and A's root motion", () => {
    const { world, shot, environment } = stage();
    expect(shot.subjects.filter((subject) => subject.kind === "human")).toHaveLength(2);
    expect(shot.subjects.filter((subject) => subject.kind === "object")).toHaveLength(1);
    expect(shot.environment?.worldId).toBe(world.id);
    expect(shot.camera.status).toBe("ready");

    const actorA = shot.subjects.find((subject) => subject.name === "A");
    const actorB = shot.subjects.find((subject) => subject.name === "B");
    const cup = shot.subjects.find((subject) => subject.name === "Cup");
    if (!actorA || !actorB || !cup || actorA.kind === "light" || actorB.kind === "light") {
      throw new Error("stage subjects missing");
    }

    const graph = projectShotDependencies({
      shot,
      worlds: { [world.id]: world },
      environment,
      modelVersion: "video-0.1",
      seed: 3,
    });
    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      return;
    }
    expect(graph.fps).toBe(shot.time.fps);
    expect(graph.assetId).toBe(world.id);
    expect(graph.nodes.every((node) => node.output.fingerprint.assetRevision.assetId === world.id)).toBe(true);
    expect(graph.assetId).not.toBe(actorB.assetId);

    const rootA = findNode(graph.nodes, "root_motion", actorA.id);
    const contactB = findNode(graph.nodes, "contact_hand", actorB.id);
    const downstreamB = findNode(graph.nodes, "contact_hand_downstream", actorB.id);
    const camera = graph.nodes.find((node) => node.entity === "camera_take");
    const room = graph.nodes.find((node) => node.entity === "room");
    const prop = graph.nodes.find((node) => node.entity === "prop" && node.unitId === cup.id);
    expect(camera && room && prop).toBeTruthy();
    if (!camera || !room || !prop) {
      return;
    }

    expect(rootA.value).toMatchObject({ fps: shot.time.fps, channel: "root_motion", frames: [{ frame: 0 }, { frame: 24 }] });
    expect(contactB.value).toMatchObject({ fps: shot.time.fps, channel: "contact_hand", frames: [{ frame: 0 }] });
    expect(camera.value).toMatchObject({ fps: shot.time.fps, entity: "camera_take", keys: [{ frame: 0 }, { frame: 24 }] });
    expect(rootA.output.fingerprint.modelVersion).toBe("video-0.1");
    expect(contactB.output.fingerprint.seed).toBe(3);

    const kept = [camera, room, rootA, prop];
    const originalKept = kept.map((node) => ({
      cache: graph.caches[node.output.cacheId],
      hash: node.hash,
      value: node.value,
      fingerprint: node.output.fingerprint,
    }));

    const edited = step(shot, {
      type: "KEY_SUBJECT_POSE",
      shotId: shot.id,
      subjectId: actorB.id,
      key: poseKey(0, [1, 0, 0], [0, 0.4, 0]),
    });
    const next = projectShotDependencies({
      shot: edited,
      worlds: { [world.id]: world },
      environment,
      modelVersion: "video-0.1",
      seed: 3,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) {
      return;
    }

    let store: OutputProvenanceStore = {};
    graph.outputs.forEach((output) => {
      const recorded = recordComputedOutput(store, output);
      expect(recorded.ok).toBe(true);
      if (recorded.ok) {
        store = recorded.store;
      }
    });
    const detection = detectOutdatedOutputs(
      store,
      Object.fromEntries(next.outputs.map((output) => [output.outputId, output.fingerprint])),
    );
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated.map((item) => item.outputId).sort()).toEqual(
      [contactB.output.outputId, downstreamB.output.outputId].sort(),
    );
    expect(detection.outdated.every((item) => item.changes.length === 1 && item.changes[0]?.key === "passHash")).toBe(true);

    const plan = planRevisionScope(
      {
        shotId: shot.id,
        operation: "edit_contact_hand_pose",
        preserve: ["camera", "room/background", { entity: "pose", subjectId: actorA.id, channel: "root_motion" }],
        recompute: [{ entity: "pose", subjectId: actorB.id, channel: "contact_hand" }],
      },
      { outputs: graph.outputs, downstreamByNodeId: graph.downstreamByNodeId },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds.sort()).toEqual([contactB.output.outputId, downstreamB.output.outputId].sort());
    expect(plan.preservedOutputIds).toEqual(expect.arrayContaining([camera.output.outputId, room.output.outputId, rootA.output.outputId]));
    expect(plan.invalidateOutputIds).not.toContain(rootA.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(camera.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(room.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(prop.output.outputId);

    const clip: TimelineClip = {
      id: shot.id,
      name: shot.name,
      start: 0,
      end: shot.time.durationFrames,
      duration: shot.time.durationFrames,
      sourceType: "generated",
      clipGraphId: "graph-shot-record",
      cacheStatus: "valid",
      proxyCacheId: camera.output.cacheId,
      finalCacheId: rootA.output.cacheId,
    };
    const applied = applyRevisionPlan(graph.caches, plan, "t1", { [clip.id]: clip });
    expect(applied.applied).toBe(true);
    expect(applied.caches[contactB.output.cacheId]?.status).toBe("invalid");
    expect(applied.caches[downstreamB.output.cacheId]?.status).toBe("invalid");
    expect(graph.caches[contactB.output.cacheId]?.status).toBe("valid");
    expect(applied.clips?.[clip.id]?.clipGraphId).toBe("graph-shot-record");
    expect(applied.clips?.[clip.id]?.cacheStatus).toBe("valid");

    kept.forEach((node, index) => {
      const snapshot = originalKept[index];
      const again = next.nodes.find((item) => item.output.outputId === node.output.outputId);
      expect(again?.hash).toBe(snapshot?.hash);
      expect(again?.value).toEqual(snapshot?.value);
      expect(again?.output.fingerprint).toEqual(snapshot?.fingerprint);
      expect(applied.caches[node.output.cacheId]).toBe(snapshot?.cache);
      expect(applied.caches[node.output.cacheId]?.status).toBe("valid");
      expect(applied.caches[node.output.cacheId]?.dependencyHash).toBe(snapshot?.hash);
    });

    const nextContact = findNode(next.nodes, "contact_hand", actorB.id);
    expect(nextContact.hash).not.toBe(contactB.hash);
    expect(nextContact.value).not.toEqual(contactB.value);
  });
});
