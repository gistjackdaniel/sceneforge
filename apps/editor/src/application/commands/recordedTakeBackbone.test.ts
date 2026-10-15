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
  parameters: { focalLengthMm: 35, sensorPreset: "full-frame" },
  params: { focalLengthMm: 35, sensorPreset: "full-frame" },
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
    "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a"], playhead: 0, visibleRange: [0, 200] },
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
        { id: "e1", sourceNodeId: "node-clip-a-trajectory", sourcePort: "out", targetNodeId: "render", targetPort: "in", kind: "data" },
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

describe("recorded camera take to Backbone v0.1", () => {
  it("applies a batch of ADD_CAMERA_KEYFRAME as one undo unit and exports valid c2w", () => {
    const project = projectFixture();
    let bus = emptyCommandBusState();
    const cmds = Array.from({ length: 6 }).map((_, i) => ({
      type: "ADD_CAMERA_KEYFRAME" as const,
      clipId: "clip-a",
      t: i * 8,
      position: [i * 0.1, 1.5, 2.0 - i * 0.1],
      quaternion: [0, 0, 0, 1],
      focalLengthMm: 35,
    }));
    const applied = executeCommand(project, bus, { type: "APPLY_COMMANDS", commands: cmds }, now);
    expect(applied.result.ok).toBe(true);
    expect(applied.bus.undoStack.length).toBe(1); // single inverse for batch
    const cam = buildBackboneCameraForClip(applied.project, "clip-a", [1280, 720], { fps: 16, numFrames: 48 });
    expect(cam.frames.length).toBe(48);
    const c2w = cam.frames[0].c2w;
    expect(c2w.length).toBe(4);
    expect(c2w[0].length).toBe(4);
  });
});

