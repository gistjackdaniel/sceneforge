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

  it("rename does not mark downstream dirty", () => {
    const { project, result } = applyCommand(
      projectFixture(),
      { type: "RENAME_NODE", nodeId: "light", name: "Window Light" },
      { timestamp: now },
    );
    expect(result.ok).toBe(true);
    expect(project.nodes.light.name).toBe("Window Light");
    expect(project.nodes.light.status).toBe("clean");
    expect(project.nodes.render.status).toBe("clean");
  });
});
