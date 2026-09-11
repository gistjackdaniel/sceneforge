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

const projectWithPreexistingElementRef = (): { project: Project; worldId: string; elementId: string; preNodeId: string } => {
  const world = createMeshExampleWorld();
  const element = world.elements[1]!;
  const clipId = "clip-a";
  const graphId = "g-a";
  const preNodeId = "node-custom-elementref";
  const project: Project = {
    id: "p",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "Main", clipIds: [clipId], playhead: 0, visibleRange: [0, 120] } },
    clips: {
      [clipId]: {
        id: clipId,
        name: "A",
        start: 0,
        end: 48,
        duration: 48,
        startFrame: 0,
        durationFrames: 48,
        sourceType: "empty",
        clipGraphId: graphId,
        cacheStatus: "valid",
      },
    },
    clipGraphs: {
      [graphId]: {
        id: graphId,
        clipId,
        rootNodeId: `node-${clipId}-clip`,
        nodeIds: [`node-${clipId}-clip`, `node-${clipId}-render`, preNodeId],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      [`node-${clipId}-clip`]: nodeBase(`node-${clipId}-clip`, "TimelineClipNode", { clipId }),
      [`node-${clipId}-render`]: nodeBase(`node-${clipId}-render`, "RenderSettingsNode"),
      [preNodeId]: nodeBase(preNodeId, "WorldElementRefNode", {
        worldId: world.id,
        worldElementId: element.id,
        elementKind: element.kind,
        elementName: element.name,
        visible: true,
      }),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: {
        [`node-${clipId}-clip`]: [clipId],
        [`node-${clipId}-render`]: [clipId],
        [preNodeId]: [clipId],
      },
      referencesByNodeId: {},
      cacheHashesByClipId: { [clipId]: "hash" },
    },
    worlds: { [world.id]: world },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    modelExecutions: {},
  };
  return { project, worldId: world.id, elementId: element.id, preNodeId };
};

describe("deduplicate/adopt element ref nodes", () => {
  it("adopts existing WorldElementRefNode by elementId instead of creating a duplicate", () => {
    const { project, worldId, elementId, preNodeId } = projectWithPreexistingElementRef();
    const linked = linkWorldToClip(project, { clipId: "clip-a", worldId, timestamp: now });
    // It should keep the preexisting node id
    const kept = linked.project.nodes[preNodeId];
    expect(kept?.kind).toBe("WorldElementRefNode");
    expect(kept?.parameters.worldElementId).toBe(elementId);
    // Ensure no duplicate was created
    const allElementRefs = Object.values(linked.project.nodes).filter((n) => n.kind === "WorldElementRefNode" && n.parameters.worldElementId === elementId);
    expect(allElementRefs.length).toBe(1);
  });
});

