import { describe, expect, it } from "vitest";
import { CameraTakeSource } from "../../domain/render/cameraTakeSource";
import { applyShotCommand, parseShot, shotId, subjectId, type CameraTake, type Shot, type ShotCommand } from "../../domain/shot";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import { createMeshExampleWorld } from "../../domain/worlds/sampleWorlds";
import { invalidateOutdatedCaches } from "../cache/invalidation";
import { rekeyCacheEntry } from "../cache/legacyLookup";
import {
  buildDependencyFingerprint,
  cameraPassFrames,
  cameraPassRenderSpec,
  createLegacyIdResolver,
  detectOutdatedOutputs,
  hashNormalized,
  projectShotDependencies,
  recordComputedOutput,
  type OutputProvenanceStore,
  type ShotDependencyGraph,
  type ShotDependencyNode,
} from "./index";

const now = "2026-11-12T00:00:00.000Z";
const SHOT_ID = "shot-camera-frames";
const ACTOR = "subject-A";
const CUP = "cup";

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
    id: SHOT_ID,
    name: SHOT_ID,
    time: { fps: 16, durationFrames: 32, origin: "clip_local" },
    subjects: [],
    camera: {
      status: "empty",
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
      interpolation: "linear",
    },
    renders: [],
  });
  const id = shotId(shot.id);
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "human", id: ACTOR, name: "A", fileUri: "actors/a.glb" } });
  shot = step(shot, { type: "ADD_SUBJECT", shotId: id, draft: { kind: "object", id: CUP, name: "Cup", fileUri: "props/cup.glb" } });
  shot = step(shot, {
    type: "KEY_SUBJECT_POSE",
    shotId: id,
    subjectId: subjectId(ACTOR),
    key: { frame: 0, position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
  });
  shot = step(shot, {
    type: "KEY_CAMERA",
    shotId: id,
    key: { frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
  });
  shot = step(shot, {
    type: "KEY_CAMERA",
    shotId: id,
    key: { frame: 16, position: [0.4, 1.6, 3.2], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
  });
  shot = parseShot({ ...shot, environment: { worldId: world.id } });
  return { world, shot, environment: environmentFromWorld(world) };
};

const project = (
  shot: Shot,
  world: ReturnType<typeof createMeshExampleWorld>,
  environment: ReturnType<typeof environmentFromWorld>,
): Extract<ShotDependencyGraph, { ok: true }> => {
  const graph = projectShotDependencies({
    shot,
    worlds: { [world.id]: world },
    environment,
    modelVersion: "video-0.1",
    seed: 3,
  });
  if (!graph.ok) {
    throw new Error(graph.message);
  }
  return graph;
};

const requireNode = (nodes: ShotDependencyNode[], predicate: (node: ShotDependencyNode) => boolean, label: string) => {
  const node = nodes.find(predicate);
  if (!node) {
    throw new Error(label);
  }
  return node;
};

const withTake = (shot: Shot, patch: Partial<CameraTake>): Shot => {
  const camera = shot.camera;
  if (camera.status !== "ready") {
    throw new Error("camera");
  }
  const selected = camera.takes.find((item) => item.id === camera.selectedTakeId);
  if (!selected) {
    throw new Error("take");
  }
  const next: CameraTake = { ...selected, ...patch };
  const takes = camera.takes.map((item) => (item.id === selected.id ? next : item));
  const [first, ...rest] = takes;
  if (!first) {
    throw new Error("take");
  }
  return {
    ...shot,
    camera: {
      ...camera,
      selectedTakeId: next.id,
      takes: [first, ...rest],
    },
  };
};

const recordAll = (graph: Extract<ShotDependencyGraph, { ok: true }>): OutputProvenanceStore => {
  let store: OutputProvenanceStore = {};
  graph.outputs.forEach((output) => {
    const recorded = recordComputedOutput(store, output);
    if (!recorded.ok) {
      throw new Error(recorded.issues.map((issue) => issue.message).join(" "));
    }
    store = recorded.store;
  });
  return store;
};

const containsString = (value: unknown, needle: string): boolean => {
  if (typeof value === "string") {
    return value === needle || value.includes(needle);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsString(item, needle));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsString(item, needle));
  }
  return false;
};

describe("camera take frames in the pass hash", () => {
  const { world, shot, environment } = stage();
  const actor = shot.subjects.find((subject) => subject.name === "A");
  const cup = shot.subjects.find((subject) => subject.name === "Cup");
  if (!actor || !cup || actor.kind === "light" || cup.kind === "light" || shot.camera.status !== "ready") {
    throw new Error("stage");
  }
  const take = shot.camera.takes[0];
  if (!take) {
    throw new Error("take");
  }

  const graph = project(shot, world, environment);
  const camera = requireNode(graph.nodes, (node) => node.entity === "camera_take", "camera");
  const downstream = requireNode(graph.nodes, (node) => node.channel === "camera_downstream", "downstream");
  const pose = requireNode(graph.nodes, (node) => node.channel === "root_motion", "pose");
  const contact = requireNode(graph.nodes, (node) => node.channel === "contact_hand", "contact");
  const contactDown = requireNode(graph.nodes, (node) => node.channel === "contact_hand_downstream", "contact downstream");
  const room = requireNode(graph.nodes, (node) => node.entity === "room", "room");
  const prop = requireNode(graph.nodes, (node) => node.entity === "prop", "prop");
  const independent = [pose, contact, contactDown, room, prop];

  const sampled = cameraPassFrames(shot);
  if (!sampled.ok) {
    throw new Error(sampled.message);
  }
  const trajectory = CameraTakeSource.trajectory(
    shot,
    cameraPassRenderSpec,
    sampled.frames.map((frame) => frame.frame),
  );
  if (!trajectory.ok) {
    throw new Error(trajectory.reason);
  }

  it("hashes CameraTakeSource frames without ids, on integer frames and Shot.time.fps", () => {
    expect(sampled.fps).toBe(shot.time.fps);
    expect(sampled.frames.every((frame) => Number.isInteger(frame.frame))).toBe(true);
    expect(sampled.framesHash).toBe(hashNormalized(sampled.frames));
    expect(sampled.frames).toEqual(trajectory.frames.map(({ cameraId: _id, ...frame }) => frame));
    expect(camera.value).toMatchObject({
      entity: "camera_take",
      fps: shot.time.fps,
      eulerOrder: "XYZ",
      framesHash: sampled.framesHash,
    });
    expect(downstream.value).toEqual({
      entity: "render_pass",
      upstreamPassHash: camera.hash,
      framesHash: sampled.framesHash,
      eulerOrder: "XYZ",
      fps: shot.time.fps,
    });
    expect(downstream.output.fingerprint).toEqual(buildDependencyFingerprint({
      assetId: world.id,
      revisionId: String(world.version),
      modelVersion: "video-0.1",
      seed: 3,
      pass: downstream.value,
    }));
    expect(camera.output.fingerprint.assetRevision.assetId).toBe(world.id);
    expect(graph.nodes.every((node) => node.output.fingerprint.assetRevision.assetId === world.id)).toBe(true);
    const forbidden = [
      take.id,
      take.name,
      take.calibration.calibrationId,
      actor.id,
      cup.id,
      actor.instanceId ?? "",
      cup.instanceId ?? "",
      "act_",
      "obj_",
      "cam_",
    ].filter((item) => item.length > 0);
    for (const id of forbidden) {
      expect(containsString(camera.value, id)).toBe(false);
      expect(containsString(downstream.value, id)).toBe(false);
    }
    expect(camera.downstreamNodeIds).toEqual([downstream.output.nodeId]);
  });

  const expectLayerChange = (edited: Shot) => {
    const nextSampled = cameraPassFrames(edited);
    expect(nextSampled.ok).toBe(true);
    if (!nextSampled.ok) {
      return;
    }
    expect(nextSampled.framesHash).not.toBe(sampled.framesHash);
    expect(nextSampled.frames[0]?.position).not.toEqual(sampled.frames[0]?.position);
    const next = project(edited, world, environment);
    const nextCamera = requireNode(next.nodes, (node) => node.entity === "camera_take", "next camera");
    const nextDown = requireNode(next.nodes, (node) => node.channel === "camera_downstream", "next downstream");
    expect(nextCamera.hash).not.toBe(camera.hash);
    expect(nextCamera.output.fingerprint.passHash).not.toBe(camera.output.fingerprint.passHash);
    expect(nextDown.value).toMatchObject({ upstreamPassHash: nextCamera.hash, framesHash: nextSampled.framesHash });
    expect(nextDown.hash).not.toBe(downstream.hash);
    const detection = detectOutdatedOutputs(
      recordAll(graph),
      Object.fromEntries(next.outputs.map((output) => [output.outputId, output.fingerprint])),
    );
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated.map((item) => item.outputId).sort()).toEqual(
      [camera.output.outputId, downstream.output.outputId].sort(),
    );
    expect(detection.outdated.every((item) => item.changes.length === 1 && item.changes[0]?.key === "passHash")).toBe(true);
    independent.forEach((node) => {
      const again = next.nodes.find((item) => item.output.outputId === node.output.outputId);
      expect(again?.hash).toBe(node.hash);
      expect(again?.output.fingerprint).toEqual(node.output.fingerprint);
      expect(detection.freshOutputIds).toContain(node.output.outputId);
    });
    const applied = invalidateOutdatedCaches(graph.caches, detection, graph.outputs, "t1");
    expect(applied.applied).toBe(true);
    expect(applied.caches[camera.output.cacheId]?.status).toBe("invalid");
    expect(applied.caches[downstream.output.cacheId]?.status).toBe("invalid");
    independent.forEach((node) => {
      expect(applied.caches[node.output.cacheId]).toBe(graph.caches[node.output.cacheId]);
      expect(applied.caches[node.output.cacheId]?.status).toBe("valid");
    });
    expect(graph.caches[camera.output.cacheId]?.status).toBe("valid");
  };

  it("outdates only the camera pass and its downstream when calibration values change", () => {
    expectLayerChange(withTake(shot, {
      calibration: { ...take.calibration, translation: [0, 0.25, 0], method: "marker" },
    }));
  });

  it("outdates only the camera pass and its downstream when drift values change", () => {
    expectLayerChange(withTake(shot, {
      mapping: { ...take.mapping, applyDriftCorrection: true },
      trackingEvents: [{
        kind: "drift_correction",
        frame: 0,
        correction: { translation: [0.1, 0, 0], rotation: [0, 0, 0, 1] },
      }],
    }));
  });

  it("keeps the pass hash and hits the cache when only the take name or id changes", () => {
    const named = withTake(shot, { name: "Plate B" });
    const namedGraph = project(named, world, environment);
    const namedCamera = requireNode(namedGraph.nodes, (node) => node.entity === "camera_take", "named camera");
    const namedDown = requireNode(namedGraph.nodes, (node) => node.channel === "camera_downstream", "named downstream");
    expect(namedCamera.hash).toBe(camera.hash);
    expect(namedDown.hash).toBe(downstream.hash);
    expect(namedCamera.output.fingerprint.passHash).toBe(camera.output.fingerprint.passHash);
    const namedDetection = detectOutdatedOutputs(
      recordAll(graph),
      Object.fromEntries(namedGraph.outputs.map((output) => [output.outputId, output.fingerprint])),
    );
    expect(namedDetection.ok).toBe(true);
    if (!namedDetection.ok) {
      return;
    }
    expect(namedDetection.outdated).toEqual([]);
    expect(namedGraph.caches[camera.output.cacheId]?.dependencyHash).toBe(camera.hash);
    expect(namedGraph.caches[camera.output.cacheId]?.status).toBe("valid");

    const nextId = "cam_01ARZ3NDEKTSV4RRFFQ69G5FAV" as typeof take.id;
    expect(nextId).not.toBe(take.id);
    const renamed = withTake(shot, {
      id: nextId,
      name: "Renamed take",
      calibration: { ...take.calibration, calibrationId: "cal_renamed_only" },
      legacyRefs: [{ kind: "camera_take", shotId: shot.id, takeId: take.id }],
    });
    const renamedGraph = project(renamed, world, environment);
    const renamedCamera = requireNode(renamedGraph.nodes, (node) => node.entity === "camera_take" && node.unitId === nextId, "renamed camera");
    const renamedDown = requireNode(renamedGraph.nodes, (node) => node.channel === "camera_downstream", "renamed downstream");
    expect(renamedCamera.hash).toBe(camera.hash);
    expect(renamedDown.hash).toBe(downstream.hash);
    expect(renamedCamera.output.fingerprint).toEqual(camera.output.fingerprint);
    expect(renamedDown.output.fingerprint.passHash).toBe(downstream.output.fingerprint.passHash);
    expect(containsString(renamedCamera.value, nextId)).toBe(false);
    expect(containsString(renamedCamera.value, take.id)).toBe(false);
    expect(containsString(renamedCamera.value, "cal_renamed_only")).toBe(false);
    expect(containsString(renamedDown.value, nextId)).toBe(false);
    const resolver = createLegacyIdResolver([renamed.camera.status === "ready" ? renamed.camera.takes[0] : take]);
    const looked = rekeyCacheEntry(graph.caches, renamedCamera.output.cacheId, resolver);
    expect(looked.hit).toBe(true);
    expect(looked.via).toBe("legacy");
    expect(looked.entry?.dependencyHash).toBe(camera.hash);
    expect(looked.entry?.status).toBe("valid");
    const lookedDown = rekeyCacheEntry(graph.caches, renamedDown.output.cacheId, resolver);
    expect(lookedDown.hit).toBe(true);
    expect(lookedDown.entry?.dependencyHash).toBe(downstream.hash);
  });

  it("returns missing_shot_fps when Shot.time.fps is missing or not positive", () => {
    const deleted = { ...shot.time };
    Reflect.deleteProperty(deleted, "fps");
    const times = [
      deleted,
      { ...shot.time, fps: 0 },
      { ...shot.time, fps: -1 },
      { ...shot.time, fps: Number.NaN },
      { ...shot.time, fps: Number.POSITIVE_INFINITY },
    ];
    for (const time of times) {
      expect(cameraPassFrames({ ...shot, time })).toEqual({
        ok: false,
        error: "missing_shot_fps",
        message: "Shot.time.fps가 없거나 양수가 아닙니다.",
      });
    }
  });
});
