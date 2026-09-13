import { describe, it, expect } from "vitest";
import { WorkspaceFocus } from "./workspaceFocus";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";

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

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a", "clip-b"], playhead: 0, visibleRange: [0, 200] } },
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
      cameraPathNodeId: "node-clip-a-trajectory",
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
      nodeIds: ["node-clip-a-clip", "node-clip-a-render", "node-clip-a-trajectory"],
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
    "node-clip-a-trajectory": node("node-clip-a-trajectory", "CameraPathNode"),
    "node-clip-b-clip": node("node-clip-b-clip", "TimelineClipNode", { clipId: "clip-b" }),
    "node-clip-b-render": node("node-clip-b-render", "RenderSettingsNode"),
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: {},
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
});

describe("WorkspaceFocus.focusClipGraph", () => {
  it("selects the clip and switches the main panel to graph", () => {
    const project = projectFixture();
    const ui = {
      selectedClipId: "clip-b",
      selectedNodeId: "node-clip-b-clip",
      selectedLibraryNodeId: undefined,
      panelTab: "viewport" as const,
      mainPanel: "playback" as const,
      playback: "stopped" as const,
      workflowLog: [],
      assistantMessages: [],
      highlightedNodeIds: [],
      viewportTool: "navigate" as const,
      viewportWorkspace: "build" as const,
      outputAspect: "16:9" as const,
      viewportOverlays: { actorMarks: true, cameraAnchors: true, lightSockets: true, propSockets: true, walkableZones: true },
      cameraViz: { frustum: true, path: true, lookAtLine: true, keyframeMarkers: true },
      renderQueue: { proxy: [], final: [] },
      commandBus: { history: [], future: [] },
      showWorldOverlay: true,
      domainJobQueue: { items: [] },
      worldGenDraft: { imageName: "", imageAssetId: "", imageThumbnailUri: "", prompt: "", trajectoryLabel: "", seed: "" },
    } as any;

    const next = WorkspaceFocus.focusClipGraph(project, ui, "clip-a");
    expect(next.selectedClipId).toBe("clip-a");
    expect(next.selectedNodeId).toBe("node-clip-a-clip");
    expect(next.mainPanel).toBe("graph");
    expect(next.highlightedNodeIds).toContain("node-clip-a-trajectory");
  });
});

