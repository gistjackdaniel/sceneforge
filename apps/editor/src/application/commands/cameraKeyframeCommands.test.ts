import { describe, it, expect } from "vitest";
import { emptyCommandBusState, executeCommand } from "./bus";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { buildBackboneCameraForClip } from "../services/backboneExport";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();

const renderNode = (): NodeBase => ({
  id: "render",
  name: "Render",
  kind: "RenderSettingsNode",
  type: "RenderSettingsNode",
  category: "render",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: {},
  params: {},
  downstreamNodeIds: [],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const cameraPathNode = (): NodeBase => ({
  id: "node-clip-a-trajectory",
  name: "Camera Path",
  kind: "CameraPathNode",
  type: "CameraPathNode",
  category: "cinematic",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: { keyframes: [], interpolation: "linear" },
  params: { keyframes: [], interpolation: "linear" },
  downstreamNodeIds: ["render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const lensNode = (): NodeBase => ({
  id: "node-clip-a-lens",
  name: "Lens",
  kind: "LensNode",
  type: "LensNode",
  category: "cinematic",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: { focalLengthMm: 36, sensorPreset: "full-frame" },
  params: { focalLengthMm: 36, sensorPreset: "full-frame" },
  downstreamNodeIds: ["render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: {
    "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a"], playhead: 12, visibleRange: [0, 200] },
  },
  clips: {
    "clip-a": {
      id: "clip-a",
      name: "A",
      start: 0,
      end: 48,
      duration: 48,
      startFrame: 0,
      durationFrames: 48,
      sourceType: "empty",
      clipGraphId: "g-a",
      cameraPathNodeId: "node-clip-a-trajectory",
      cacheStatus: "valid",
    },
  },
  clipGraphs: {
    "g-a": {
      id: "g-a",
      clipId: "clip-a",
      rootNodeId: "render",
      nodeIds: ["render", "node-clip-a-trajectory", "node-clip-a-lens"],
      edges: [
        {
          id: "e1",
          sourceNodeId: "node-clip-a-trajectory",
          sourcePort: "out",
          targetNodeId: "render",
          targetPort: "in",
          kind: "data",
        },
      ],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
  },
  nodes: {
    render: renderNode(),
    "node-clip-a-trajectory": cameraPathNode(),
    "node-clip-a-lens": lensNode(),
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: { render: [], "node-clip-a-trajectory": ["render"], "node-clip-a-lens": ["render"] },
    clipsByNodeId: { render: ["clip-a"], "node-clip-a-trajectory": ["clip-a"], "node-clip-a-lens": ["clip-a"] },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-a": "ha" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("camera keyframe domain commands", () => {
  it("records combined translate+rotate as a single command (UPDATE_CAMERA_KEYFRAME)", () => {
    let project = projectFixture();
    let bus = emptyCommandBusState();
    const executed = executeCommand(
      project,
      bus,
      {
        type: "UPDATE_CAMERA_KEYFRAME",
        clipId: "clip-a",
        t: 12,
        position: [2.5, 1.8, 3.2],
        quaternion: [0, 0, 0, 1],
      },
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.bus.undoStack.length).toBe(1);
    project = executed.project;
    bus = executed.bus;
    const executed2 = executeCommand(
      project,
      bus,
      {
        type: "UPDATE_CAMERA_KEYFRAME",
        clipId: "clip-a",
        t: 12,
        position: [2.8, 1.6, 2.9],
        // small yaw
        quaternion: [0, Math.sin(0.1), 0, Math.cos(0.1)],
      },
      now,
    );
    expect(executed2.result.ok).toBe(true);
    expect(executed2.bus.undoStack.length).toBe(2);
  });

  it("exports Backbone v0.1 camera trajectory with per-frame K and c2w", () => {
    const project = projectFixture();
    // Seed two keyframes for interpolation
    const bus = emptyCommandBusState();
    const r1 = executeCommand(
      project,
      bus,
      {
        type: "ADD_CAMERA_KEYFRAME",
        clipId: "clip-a",
        t: 0,
        position: [0, 1, 2],
        quaternion: [0, 0, 0, 1],
      },
      now,
    );
    const r2 = executeCommand(
      r1.project,
      r1.bus,
      {
        type: "ADD_CAMERA_KEYFRAME",
        clipId: "clip-a",
        t: 47,
        position: [2, 1, 0],
        quaternion: [0, 0, 0, 1],
      },
      now,
    );
    const cam = buildBackboneCameraForClip(r2.project, "clip-a", [1280, 720], { fps: 16, numFrames: 48 });
    expect(cam.version).toBe("0.1");
    expect(cam.convention).toBe("opencv_c2w");
    expect(cam.frames.length).toBe(48);
    // K is 3x3 with cx,cy at center
    const K = cam.frames[0].K;
    expect(K.length).toBe(3);
    expect(K[0].length).toBe(3);
    expect(K[1][1]).toBeCloseTo(K[0][0], 6);
    expect(K[0][2]).toBeCloseTo(1280 / 2, 6);
    expect(K[1][2]).toBeCloseTo(720 / 2, 6);
    // c2w is 4x4
    const c2w = cam.frames[0].c2w;
    expect(c2w.length).toBe(4);
    expect(c2w[0].length).toBe(4);
  });
});

