import { describe, it, expect } from "vitest";
import type { EditorUiState } from "../../state/editorStore";
import type { ClipGraph } from "../../domain/project/clipGraph";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { NodeFinderService } from "./nodeFinder";

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

const makeUi = (): EditorUiState => ({
  selectedClipId: "clip-1",
  selectedNodeId: "n-clip-root",
  panelTab: "viewport",
  mainPanel: "graph",
  playback: "stopped",
  workflowLog: [],
  assistantMessages: [],
  highlightedNodeIds: [],
  worldGenDraft: {
    imageName: "",
    imageAssetId: "",
    imageThumbnailUri: "",
    prompt: "",
    trajectoryLabel: "",
    seed: "",
  },
  viewportTool: "navigate",
  viewportWorkspace: "build",
  outputAspect: { id: "16:9", width: 1920, height: 1080 },
  viewportOverlays: { actorMarks: true, cameraAnchors: true, lightSockets: true, propSockets: true, walkableZones: true },
  cameraViz: { frustum: true, path: true, lookAtLine: true, keyframeMarkers: true },
  renderQueue: { proxy: [], final: [] },
  commandBus: { past: [], future: [], pointer: -1 },
  showWorldOverlay: true,
  domainJobQueue: { proxy: [], final: [] },
});

describe("NodeFinderService.focusNodeInSelectedClip", () => {
  it("focuses a node that belongs to the selected clip graph", () => {
    const project = makeProject();
    const ui = makeUi();
    const next = NodeFinderService.focusNodeInSelectedClip(project, ui, "n-camera");
    expect(next.selectedNodeId).toBe("n-camera");
    expect(next.highlightedNodeIds).toEqual(["n-camera"]);
  });

  it("does nothing when the node is outside the selected clip graph", () => {
    const project = makeProject();
    const ui = makeUi();
    const next = NodeFinderService.focusNodeInSelectedClip(project, ui, "not-in-graph");
    expect(next).toEqual(ui);
  });
});

