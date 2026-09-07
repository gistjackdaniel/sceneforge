import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/apply";
import { emptyCommandBusState, executeCommand } from "../commands/bus";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import type { Project } from "../../domain/project/types";
import { findWorldReferenceNode, linkWorldToClip } from "./worldLinking";
import { persistWorldGeneration } from "./worldGeneration";

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
        rootNodeId: "node-clip-a-clip",
        nodeIds: ["node-clip-a-clip", "node-clip-a-render"],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
      "g-b": {
        id: "g-b",
        clipId: "clip-b",
        rootNodeId: "node-clip-b-clip",
        nodeIds: ["node-clip-b-clip", "node-clip-b-render"],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      "node-clip-a-clip": node("node-clip-a-clip", "TimelineClipNode", { clipId: "clip-a" }),
      "node-clip-a-render": node("node-clip-a-render", "RenderSettingsNode"),
      "node-clip-b-clip": node("node-clip-b-clip", "TimelineClipNode", { clipId: "clip-b" }),
      "node-clip-b-render": node("node-clip-b-render", "RenderSettingsNode"),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: { "node-clip-a-worldref": ["node-clip-a-render"] },
      clipsByNodeId: {
        "node-clip-a-clip": ["clip-a"],
        "node-clip-a-render": ["clip-a"],
        "node-clip-b-clip": ["clip-b"],
        "node-clip-b-render": ["clip-b"],
      },
      referencesByNodeId: {},
      cacheHashesByClipId: { "clip-a": "hash-a", "clip-b": "hash-b" },
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

describe("linkWorldToClip", () => {
  it("creates WorldReferenceNode and linkedWorldId for the current clip only", () => {
    const project = projectFixture();
    const linked = linkWorldToClip(project, { clipId: "clip-a", worldId: "world-1", timestamp: now });
    expect(linked.created).toBe(true);
    expect(linked.project.clips["clip-a"].linkedWorldId).toBe("world-1");
    expect(linked.project.clips["clip-b"].linkedWorldId).toBeUndefined();
    expect(findWorldReferenceNode(linked.project, "clip-a", "world-1")?.kind).toBe("WorldReferenceNode");
    expect(findWorldReferenceNode(linked.project, "clip-b", "world-1")).toBeUndefined();
  });

  it("does not duplicate WorldReferenceNode when the same world is linked twice", () => {
    const project = projectFixture();
    const first = linkWorldToClip(project, { clipId: "clip-a", worldId: "world-1", timestamp: now });
    const second = linkWorldToClip(first.project, { clipId: "clip-a", worldId: "world-1", timestamp: now });
    expect(second.alreadyLinked).toBe(true);
    const refs = Object.values(second.project.nodes).filter((item) => item.kind === "WorldReferenceNode");
    expect(refs).toHaveLength(1);
  });

  it("previewing a world is a no-op on the clip graph", () => {
    const project = projectFixture();
    expect(project.clips["clip-a"].linkedWorldId).toBeUndefined();
    expect(Object.values(project.nodes).some((item) => item.kind === "WorldReferenceNode")).toBe(false);
  });
});

describe("LINK_CLIP_WORLD command", () => {
  it("is a single undo unit", () => {
    const project = projectFixture();
    const executed = executeCommand(
      project,
      emptyCommandBusState(),
      { type: "LINK_CLIP_WORLD", clipId: "clip-a", worldId: "world-1" },
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.project.clips["clip-a"].linkedWorldId).toBe("world-1");
    const undone = applyCommand(
      executed.project,
      executed.result.inverse!,
      { timestamp: now },
    );
    expect(undone.project.clips["clip-a"].linkedWorldId).toBeUndefined();
  });
});
