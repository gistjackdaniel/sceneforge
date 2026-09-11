import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, undoCommand, redoCommand } from "../commands/bus";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { buildCameraKeyframePatch, buildPlacementParams, cameraPathNodeIdForClip, placementNodeIdForElement } from "./viewportCommit";
import { createNodeBase } from "./nodeFactory";

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
      cameraPathNodeId: cameraPathNodeIdForClip({ id: "clip-a", cameraPathNodeId: "node-clip-a-trajectory", cameraTrajectoryNodeId: undefined }),
      cacheStatus: "valid",
    },
  },
  clipGraphs: {
    "g-a": {
      id: "g-a",
      clipId: "clip-a",
      rootNodeId: "render",
      nodeIds: ["render", "node-clip-a-trajectory"],
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
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: { render: [], "node-clip-a-trajectory": ["render"] },
    clipsByNodeId: { render: ["clip-a"], "node-clip-a-trajectory": ["clip-a"] },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-a": "ha" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("viewport-style commits go through command bus", () => {
  it("updates CameraPathNode via UPDATE_NODE_PARAMS with undo/redo", () => {
    let project = projectFixture();
    let bus = emptyCommandBusState();
    const nodeId = cameraPathNodeIdForClip({ id: "clip-a", cameraPathNodeId: "node-clip-a-trajectory", cameraTrajectoryNodeId: undefined });
    const node = project.nodes[nodeId];
    const patch = buildCameraKeyframePatch(node.parameters, {
      frame: 12,
      position: [2.5, 1.8, 3.2],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    const executed = executeCommand(project, bus, { type: "UPDATE_NODE_PARAMS", nodeId, patch: { ...patch } }, now);
    expect(executed.result.ok).toBe(true);
    expect(executed.project.nodes[nodeId].parameters.keyframes?.length ?? 0).toBeGreaterThan(0);
    expect(executed.bus.undoStack.length).toBe(1);

    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes[nodeId].parameters.keyframes?.length ?? 0).toBe(0);

    const redone = redoCommand(undone.project, undone.bus, now);
    expect(redone.project.nodes[nodeId].parameters.keyframes?.length ?? 0).toBeGreaterThan(0);
  });

  it("creates PlacementNode via CREATE_NODE with clipGraphId and supports undo", () => {
    let project = projectFixture();
    let bus = emptyCommandBusState();
    const clip = project.clips["clip-a"];
    const nodeId = placementNodeIdForElement(clip.id, "prop-1");
    const params = buildPlacementParams({
      worldElementId: "prop-1",
      kind: "prop",
      position: [0.4, 0, -0.3],
      rotation: [0, 0, 0],
      scale: undefined,
      layer: "clip",
    });
    const created = createNodeBase({
      id: nodeId,
      name: `prop prop-1`,
      kind: "PlacementNode",
      category: "cinematic",
      parameters: params,
      timestamp: now,
      downstreamNodeIds: ["render"],
    });
    const executed = executeCommand(project, bus, { type: "CREATE_NODE", node: created, clipGraphId: clip.clipGraphId }, now);
    expect(executed.result.ok).toBe(true);
    expect(executed.project.nodes[nodeId]).toBeTruthy();
    expect(executed.project.clipGraphs[clip.clipGraphId].nodeIds).toContain(nodeId);
    expect(executed.bus.undoStack.length).toBe(1);

    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes[nodeId]).toBeUndefined();
    expect(undone.project.clipGraphs[clip.clipGraphId].nodeIds).not.toContain(nodeId);
  });
});

