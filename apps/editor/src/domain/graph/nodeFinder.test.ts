import { describe, it, expect } from "vitest";
import type { ClipGraph } from "../project/clipGraph";
import type { Project } from "../project/types";
import { defaultPorts, type NodeBase } from "./types";
import { ClipGraphNodeFinder } from "./nodeFinder";

const node = (id: string, name: string, kind: NodeBase["kind"], category: NodeBase["category"]): NodeBase => ({
  id,
  name,
  kind,
  type: kind,
  category,
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: {},
  params: {},
  downstreamNodeIds: [],
  status: "clean",
  ...defaultPorts(),
  createdAt: "t",
  updatedAt: "t",
});

const makeProject = (): Project => {
  const clipId = "clip-1";
  const graphId = "graph-1";
  const nodes: Record<string, NodeBase> = {
    "n-clip-root": node("n-clip-root", "Timeline Clip Root", "TimelineClipNode", "capture"),
    "n-camera": node("n-camera", "Camera Path", "CameraPathNode", "cinematic"),
    "n-render": node("n-render", "Render Settings", "RenderSettingsNode", "render"),
    "n-source": node("n-source", "Image Source", "ImageSourceNode", "source"),
    "n-light": node("n-light", "Lighting Rig", "LightingRigNode", "cinematic"),
  };
  const graph: ClipGraph = {
    id: graphId,
    clipId,
    rootNodeId: "n-clip-root",
    nodeIds: Object.keys(nodes),
    edges: [],
    previewFrames: [],
    finalFrames: [],
    keyframeNodeIds: [],
  };
  return {
    id: "p",
    name: "Test",
    createdAt: "t",
    updatedAt: "t",
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "Main", clipIds: [clipId], playhead: 0, visibleRange: [0, 120] } },
    clips: {
      [clipId]: {
        id: clipId,
        name: "Shot 01",
        trackId: "V1",
        start: 0,
        end: 48,
        duration: 48,
        startFrame: 0,
        durationFrames: 48,
        sourceType: "empty",
        linkedWorldId: "world",
        clipGraphId: graphId,
        cacheStatus: "invalid",
      },
    },
    clipGraphs: { [graphId]: graph },
    nodes,
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: {},
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    },
    worlds: { world: { id: "world", name: "World" } as any },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};

describe("ClipGraphNodeFinder.filter", () => {
  it("filters nodes by name/kind within the clip graph", () => {
    const project = makeProject();
    const graphId = project.clips["clip-1"].clipGraphId;
    expect(ClipGraphNodeFinder.filter(project, graphId, "camera")[0]?.nodeId).toBe("n-camera");
    expect(ClipGraphNodeFinder.filter(project, graphId, "render")[0]?.nodeId).toBe("n-render");
    expect(ClipGraphNodeFinder.filter(project, graphId, "image")[0]?.nodeId).toBe("n-source");
  });

  it("requires all tokens to match", () => {
    const project = makeProject();
    const graphId = project.clips["clip-1"].clipGraphId;
    const results = ClipGraphNodeFinder.filter(project, graphId, "camera path");
    expect(results.find((m) => m.nodeId === "n-camera")).toBeTruthy();
    expect(results.find((m) => m.nodeId === "n-render")).toBeFalsy();
  });

  it("returns empty list for empty or missing graph", () => {
    const project = makeProject();
    const graphId = project.clips["clip-1"].clipGraphId;
    expect(ClipGraphNodeFinder.filter(project, graphId, "   ")).toEqual([]);
    expect(ClipGraphNodeFinder.filter(project, "missing", "camera")).toEqual([]);
  });
});

