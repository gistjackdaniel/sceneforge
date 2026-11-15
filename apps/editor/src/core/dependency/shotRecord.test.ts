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
  type ProductionOutput,
  type ShotDependencyNode,
} from "./index";

const now = "2026-11-12T00:00:00.000Z";
const SHOT_ID = "shot-handshake-cup";
const ACTOR_A = "inst_fixture_actor_a";
const ACTOR_B = "inst_fixture_actor_b";
const CUP = "inst_fixture_cup";
const SHOT_FPS = 16;
const FRAME_COUNT = 128;

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
    id: SHOT_ID,
    name: SHOT_ID,
    time: { fps: SHOT_FPS, durationFrames: FRAME_COUNT, origin: "clip_local" },
    subjects: [],
    camera: {
      status: "empty",
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
      interpolation: "linear",
    },
    renders: [],
  });
  const id = shotId(shot.id);
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: ACTOR_A, name: "A", fileUri: "actors/a.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: ACTOR_B, name: "B", fileUri: "actors/b.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "object", id: CUP, name: "Cup", fileUri: "props/cup.glb" } });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId(ACTOR_A),
    key: poseKey(0, [0, 0, 0]),
  });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId(ACTOR_A),
    key: poseKey(24, [0.2, 0, 0.4]),
  });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId(ACTOR_B),
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

const handshakeGraph = [
  {
    contact_id: "handshake_01",
    a: { actor_id: ACTOR_A, part: "right_hand" },
    b: { actor_id: ACTOR_B, part: "right_hand" },
    start_frame: 72,
    end_frame: 111,
    type: "grasp",
  },
  {
    contact_id: "cup_hold_01",
    a: { actor_id: ACTOR_A, part: "left_hand" },
    b: { object_id: CUP },
    start_frame: 0,
    end_frame: 47,
    type: "grasp",
  },
  {
    contact_id: "cup_place_01",
    a: { actor_id: ACTOR_A, part: "left_hand" },
    b: { object_id: CUP },
    start_frame: 32,
    end_frame: FRAME_COUNT - 1,
    type: "place",
  },
];

const withOutput = (
  base: ProductionOutput,
  nodeId: string,
  selector: ProductionOutput["selector"],
): ProductionOutput => ({
  ...base,
  outputId: `out:${nodeId}`,
  nodeId,
  cacheId: `cache:${nodeId}`,
  selector,
});

describe("shot record dependency cache", () => {
  it("recomputes B's motion and handshake_01, and keeps camera, background, A's motion, and the cup", () => {
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
    expect(contactB.value).toMatchObject({ fps: shot.time.fps, channel: "contact_hand", eulerOrder: "XYZ", frames: [{ frame: 0 }] });
    expect(camera.value).toMatchObject({ fps: shot.time.fps, entity: "camera_take", keys: [{ frame: 0 }, { frame: 24 }] });
    expect(rootA.output.fingerprint.modelVersion).toBe("video-0.1");
    expect(contactB.output.fingerprint.seed).toBe(3);

    const contactA = findNode(graph.nodes, "contact_hand", actorA.id);
    const kept = [camera, room, rootA, contactA, prop];
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

    const rootB = findNode(graph.nodes, "root_motion", actorB.id);
    const handshake = withOutput(contactB.output, "contact:handshake_01", {
      kind: "contact",
      contactId: "handshake_01",
      assetId: world.id,
    });
    const handA = withOutput(contactB.output, "contact:handshake_01:a", {
      kind: "contact",
      actorId: ACTOR_A,
      part: "right_hand",
      assetId: world.id,
    });
    const handB = withOutput(contactB.output, "contact:handshake_01:b", {
      kind: "contact",
      contactId: "handshake_01",
      actorId: ACTOR_B,
      part: "right_hand",
      assetId: world.id,
    });
    const cupHold = withOutput(contactB.output, "contact:cup_hold_01", {
      kind: "contact",
      contactId: "cup_hold_01",
      actorId: ACTOR_A,
      part: "left_hand",
      assetId: world.id,
    });
    const cupPlace = withOutput(contactB.output, "contact:cup_place_01", {
      kind: "contact",
      contactId: "cup_place_01",
      assetId: world.id,
    });
    const extras = [handshake, handA, handB, cupHold, cupPlace];
    const outputs = [...graph.outputs, ...extras];
    const downstreamByNodeId = {
      ...graph.downstreamByNodeId,
      ...Object.fromEntries(extras.map((item) => [item.nodeId, [] as string[]])),
    };
    const caches = {
      ...graph.caches,
      ...Object.fromEntries(extras.map((item) => [item.cacheId, { ...graph.caches[contactB.output.cacheId], id: item.cacheId, nodeId: item.nodeId, label: item.nodeId }])),
    };
    const plan = planRevisionScope(
      {
        shot_id: shot.id,
        operation: "change_contact_effector",
        edit_id: "edit_handshake",
        base_graph_version: "graph-shot-record",
        source: { type: "text", transcript: "B를 오른손 악수로" },
        preserve: [
          { kind: "camera_track" },
          { kind: "motion", actor_id: ACTOR_A },
          { kind: "root_motion", actor_id: ACTOR_A },
          { kind: "set_layout" },
          { kind: "background" },
          { kind: "contact", contact_id: "cup_hold_01" },
          { kind: "contact", contact_id: "cup_place_01" },
        ],
        recompute: [
          { kind: "motion", actor_id: ACTOR_B },
          { kind: "contact", contact_id: "handshake_01" },
        ],
      },
      { outputs, downstreamByNodeId, contact_graph: handshakeGraph, graphVersion: "graph-shot-record" },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds).toEqual(expect.arrayContaining([
      contactB.output.outputId,
      downstreamB.output.outputId,
      handshake.outputId,
      handA.outputId,
      handB.outputId,
    ]));
    expect(plan.invalidateOutputIds).not.toContain(rootA.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(contactA.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(rootB.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(camera.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(room.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(prop.output.outputId);
    expect(plan.invalidateOutputIds).not.toContain(cupHold.outputId);
    expect(plan.invalidateOutputIds).not.toContain(cupPlace.outputId);
    expect(plan.preservedOutputIds).toEqual(expect.arrayContaining([
      camera.output.outputId,
      room.output.outputId,
      rootA.output.outputId,
      contactA.output.outputId,
      cupHold.outputId,
      cupPlace.outputId,
    ]));
    expect(plan.reasons.every((item) => item.edit_id === "edit_handshake" && item.source?.type === "text")).toBe(true);

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
    const applied = applyRevisionPlan(caches, plan, "t1", { [clip.id]: clip });
    expect(applied.applied).toBe(true);
    expect(applied.caches[contactB.output.cacheId]?.status).toBe("invalid");
    expect(applied.caches[downstreamB.output.cacheId]?.status).toBe("invalid");
    expect(applied.caches[handshake.cacheId]?.status).toBe("invalid");
    expect(applied.caches[handA.cacheId]?.status).toBe("invalid");
    expect(applied.caches[handB.cacheId]?.status).toBe("invalid");
    expect(applied.caches[cupHold.cacheId]).toBe(caches[cupHold.cacheId]);
    expect(applied.caches[cupPlace.cacheId]?.status).toBe("valid");
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
