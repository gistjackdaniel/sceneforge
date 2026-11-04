import { describe, it, expect } from "vitest";
import { persistWorldGeneration } from "../../application/services/worldGeneration";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { linkWorldToClip, findWorldReferenceNode } from "../../application/services/worldLinking";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();
const node = (id: string, kind: NodeBase["kind"], parameters: Record<string, unknown> = {}): NodeBase => ({
  id,
  name: id,
  kind,
  type: kind,
  category: "scene",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters,
  params: parameters,
  downstreamNodeIds: [],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const projectFixture = (): Project => {
  const base: Project = {
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
        cacheStatus: "valid",
      },
    },
    clipGraphs: {
      "g-a": {
        id: "g-a",
        clipId: "clip-a",
        rootNodeId: "node-clip-a-clip",
        nodeIds: ["node-clip-a-clip", "node-clip-a-render"],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      "node-clip-a-clip": node("node-clip-a-clip", "TimelineClipNode", { clipId: "clip-a" }),
      "node-clip-a-render": node("node-clip-a-render", "RenderSettingsNode"),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: { "node-clip-a-clip": ["clip-a"], "node-clip-a-render": ["clip-a"] },
      referencesByNodeId: {},
      cacheHashesByClipId: { "clip-a": "hash-a" },
    },
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    modelExecutions: {},
  };
  return persistWorldGeneration(base, {
    worldId: "world-1",
    name: "Cafe",
    description: "gen",
    execution: {
      id: "exec-1",
      connectorId: "lyra-2.0",
      task: "image_to_world",
      inputAssetIds: ["img"],
      outputAssetIds: [],
      parameters: {},
      startedAt: now,
      completedAt: now,
      status: "completed",
    },
    artifacts: { surfaceMeshPath: "artifacts/w/mesh.glb" },
  });
};

describe("World Library select/reuse", () => {
  it("links a selected world into the current clip", () => {
    const project = projectFixture();
    const linked = linkWorldToClip(project, { clipId: "clip-a", worldId: "world-1", timestamp: now });
    expect(linked.created).toBe(true);
    expect(linked.project.clips["clip-a"].linkedWorldId).toBe("world-1");
    expect(findWorldReferenceNode(linked.project, "clip-a", "world-1")).toBeDefined();
  });
});

