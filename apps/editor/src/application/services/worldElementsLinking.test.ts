import { describe, it, expect } from "vitest";
import { linkWorldToClip } from "./worldLinking";
import type { Project } from "../../domain/project/types";
import type { NodeBase } from "../../domain/graph/types";
import { defaultPorts } from "../../domain/graph/types";
import { createMeshExampleWorld } from "../../domain/worlds/sampleWorlds";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();

const nodeBase = (id: string, kind: NodeBase["kind"], parameters: Record<string, unknown> = {}): NodeBase => ({
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
  const world = createMeshExampleWorld();
  return {
    id: "p",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "Main", clipIds: ["clip-a"], playhead: 0, visibleRange: [0, 120] } },
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
      "node-clip-a-clip": nodeBase("node-clip-a-clip", "TimelineClipNode", { clipId: "clip-a" }),
      "node-clip-a-render": nodeBase("node-clip-a-render", "RenderSettingsNode"),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: { "node-clip-a-clip": ["clip-a"], "node-clip-a-render": ["clip-a"] },
      referencesByNodeId: {},
      cacheHashesByClipId: { "clip-a": "hash-a" },
    },
    worlds: { [world.id]: world },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    modelExecutions: {},
  };
};

describe("linkWorldToClip: element refs", () => {
  it("creates WorldElementRefNode(s) for world elements", () => {
    const project = projectFixture();
    const worldId = Object.keys(project.worlds)[0]!;
    const linked = linkWorldToClip(project, { clipId: "clip-a", worldId, timestamp: now });
    const world = project.worlds[worldId];
    world.elements.forEach((element) => {
      const id = `node-clip-a-elementref-${element.id}`;
      const node = linked.project.nodes[id];
      expect(node?.kind).toBe("WorldElementRefNode");
      expect(node?.parameters.worldElementId).toBe(element.id);
      expect(node?.parameters.worldId).toBe(worldId);
    });
  });
});

