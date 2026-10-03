import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, undoCommand } from "./bus";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { ViewportPickCommand } from "./viewportPick";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();

const renderNode = (): NodeBase => ({
  id: "node-clip-1-render",
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

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-1"], playhead: 0, visibleRange: [0, 200] } },
  clips: {
    "clip-1": {
      id: "clip-1",
      name: "Clip 1",
      start: 0,
      end: 120,
      duration: 120,
      startFrame: 0,
      durationFrames: 120,
      sourceType: "empty",
      clipGraphId: "g-1",
      cacheStatus: "valid",
    },
  },
  clipGraphs: {
    "g-1": {
      id: "g-1",
      clipId: "clip-1",
      rootNodeId: "node-clip-1-render",
      nodeIds: ["node-clip-1-render"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
  },
  nodes: { "node-clip-1-render": renderNode() },
  references: {},
  dependencyMap: {
    downstreamByNodeId: { "node-clip-1-render": [] },
    clipsByNodeId: { "node-clip-1-render": ["clip-1"] },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-1": "h1" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("Viewport pick → DomainCommand → node present", () => {
  it("creates a placement node on first pick and supports undo", () => {
    const project = projectFixture();
    const pick = {
      worldElementId: "actor-a",
      kind: "actor" as const,
      position: [0.1, 0, 0.2] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    };
    const command = ViewportPickCommand.forClip(project, "clip-1", pick, now);
    const executed = executeCommand(project, emptyCommandBusState(), command, now);
    expect(executed.result.ok).toBe(true);
    const nodeId = "node-clip-1-placement-actor-a";
    expect(executed.project.nodes[nodeId]).toBeTruthy();
    expect(executed.project.clipGraphs["g-1"].nodeIds.includes(nodeId)).toBe(true);

    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes[nodeId]).toBeUndefined();
    expect(undone.project.clipGraphs["g-1"].nodeIds.includes(nodeId)).toBe(false);
  });

  it("updates an existing placement node on subsequent pick and supports undo", () => {
    // Seed a project with an existing placement
    let project = projectFixture();
    const first = ViewportPickCommand.forClip(
      project,
      "clip-1",
      { worldElementId: "prop-b", kind: "prop", position: [0, 0, 0], rotation: [0, 0, 0] },
      now,
    );
    const seeded = executeCommand(project, emptyCommandBusState(), first, now);
    project = seeded.project;

    // Apply an update pick
    const update = ViewportPickCommand.forClip(
      project,
      "clip-1",
      { worldElementId: "prop-b", kind: "prop", position: [1, 2, 3], rotation: [0.1, 0.2, 0.3] },
      now,
    );
    const executed = executeCommand(project, seeded.bus, update, now);
    const nodeId = "node-clip-1-placement-prop-b";
    expect(executed.result.ok).toBe(true);
    expect(executed.project.nodes[nodeId].parameters.position).toEqual({ x: 1, y: 2, z: 3 });

    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.nodes[nodeId].parameters.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

