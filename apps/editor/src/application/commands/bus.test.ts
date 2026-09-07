import { describe, expect, it } from "vitest";
import { applyCommand } from "./apply";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "./bus";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import type { Project } from "../../domain/project/types";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();

const lightNode = (): NodeBase => ({
  id: "light",
  name: "Light",
  kind: "LightingRigNode",
  type: "LightingRigNode",
  category: "cinematic",
  scope: "project",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "shared",
  parameters: { intensity: 0.5 },
  params: { intensity: 0.5 },
  downstreamNodeIds: ["render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const renderNode = (): NodeBase => ({
  ...lightNode(),
  id: "render",
  name: "Render",
  kind: "RenderSettingsNode",
  type: "RenderSettingsNode",
  downstreamNodeIds: [],
  parameters: {},
  params: {},
});

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: {
    "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a", "clip-b"], playhead: 0, visibleRange: [0, 200] },
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
      cacheStatus: "valid",
    },
    "clip-b": {
      id: "clip-b",
      name: "B",
      start: 48,
      end: 96,
      duration: 48,
      startFrame: 48,
      durationFrames: 48,
      sourceType: "empty",
      clipGraphId: "g-b",
      cacheStatus: "valid",
    },
  },
  clipGraphs: {
    "g-a": {
      id: "g-a",
      clipId: "clip-a",
      rootNodeId: "render",
      nodeIds: ["light", "render"],
      edges: [
        {
          id: "e1",
          sourceNodeId: "light",
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
    "g-b": {
      id: "g-b",
      clipId: "clip-b",
      rootNodeId: "orphan",
      nodeIds: ["orphan"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
  },
  nodes: {
    light: lightNode(),
    render: renderNode(),
    orphan: { ...renderNode(), id: "orphan", name: "Orphan" },
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: { light: ["render"], render: [], orphan: [] },
    clipsByNodeId: { light: ["clip-a"], render: ["clip-a"], orphan: ["clip-b"] },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-a": "ha", "clip-b": "hb" },
  },
  worlds: {},
  assets: {},
  caches: {
    "cache-a": {
      id: "cache-a",
      clipId: "clip-a",
      label: "A",
      kind: "proxy",
      status: "valid",
      updatedAt: now,
      invalidatedByNodeIds: [],
    },
    "cache-b": {
      id: "cache-b",
      clipId: "clip-b",
      label: "B",
      kind: "proxy",
      status: "valid",
      updatedAt: now,
      invalidatedByNodeIds: [],
    },
  },
  connectors: {},
  libraryNodeIds: [],
});

describe("command bus undo/redo", () => {
  it("undoes and redoes UPDATE_NODE_PARAMS as a command unit", () => {
    let project = projectFixture();
    let bus = emptyCommandBusState();
    const executed = executeCommand(
      project,
      bus,
      { type: "UPDATE_NODE_PARAMS", nodeId: "light", patch: { intensity: 0.9 } },
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.project.nodes.light.parameters.intensity).toBe(0.9);
    expect(executed.project.nodes.light.status).toBe("dirty");
    expect(executed.project.nodes.render.status).toBe("dirty");
    expect(executed.project.nodes.orphan.status).toBe("clean");

    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes.light.parameters.intensity).toBe(0.5);

    const redone = redoCommand(undone.project, undone.bus, now);
    expect(redone.project.nodes.light.parameters.intensity).toBe(0.9);
  });

  it("APPLY_CAMERA_RIG is a single undo unit writing CameraRigNode", () => {
    const project = projectFixture();
    const path: NodeBase = {
      ...lightNode(),
      id: "node-clip-a-trajectory",
      name: "Camera Path",
      kind: "CameraPathNode",
      type: "CameraPathNode",
      category: "cinematic",
      parameters: { keyframes: [], interpolation: "linear" },
      params: { keyframes: [], interpolation: "linear" },
      downstreamNodeIds: ["render"],
    };
    project.nodes["node-clip-a-trajectory"] = path;
    project.clips["clip-a"].cameraPathNodeId = "node-clip-a-trajectory";
    project.clipGraphs["g-a"].nodeIds = [...project.clipGraphs["g-a"].nodeIds, "node-clip-a-trajectory"];
    project.dependencyMap.downstreamByNodeId["node-clip-a-trajectory"] = ["render"];
    project.dependencyMap.clipsByNodeId["node-clip-a-trajectory"] = ["clip-a"];

    const executed = executeCommand(
      project,
      emptyCommandBusState(),
      {
        type: "APPLY_CAMERA_RIG",
        clipId: "clip-a",
        preset: "truck_left",
        durationFrames: 48,
        startPosition: [2.5, 1.8, 3.2],
        startRotation: [0, 0, 0],
      },
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.bus.undoStack).toHaveLength(1);
    const rig = Object.values(executed.project.nodes).find((item) => item.kind === "CameraRigNode");
    expect(rig?.parameters.preset).toBe("truck_left");
    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes[rig?.id ?? ""]).toBeUndefined();
    expect(undone.project.nodes["node-clip-a-trajectory"].parameters.keyframes).toEqual([]);
  });

  it("CREATE_NODE is a single undo unit", () => {
    const extra = lightNode();
    extra.id = "fill";
    extra.name = "Fill";
    extra.parameters = { intensity: 0.2 };
    extra.params = extra.parameters;
    extra.downstreamNodeIds = [];
    const executed = executeCommand(
      projectFixture(),
      emptyCommandBusState(),
      { type: "CREATE_NODE", node: extra },
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.project.nodes.fill).toBeTruthy();
    expect(executed.bus.undoStack).toHaveLength(1);
    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes.fill).toBeUndefined();
  });
});
