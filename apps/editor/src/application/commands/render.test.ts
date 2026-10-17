import { describe, expect, it } from "vitest";
import type { Project } from "../../domain/project/types";
import type { TimelineClip } from "../../domain/timeline/types";
import type { NodeBase } from "../../domain/graph/types";
import { defaultPorts } from "../../domain/graph/types";
import { applyCommand } from "./apply";

const now = "2026-01-01T00:00:00.000Z";
const ports = defaultPorts();

const renderNode = (id = "node-clip-001-render"): NodeBase => ({
  id,
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

const cameraPathNode = (clipId: string, withKeyframe = true): NodeBase => ({
  id: `node-${clipId}-trajectory`,
  name: "Camera Path",
  kind: "CameraPathNode",
  type: "CameraPathNode",
  category: "cinematic",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: withKeyframe
    ? { keyframes: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 }], interpolation: "linear" }
    : { keyframes: [], interpolation: "linear" },
  params: withKeyframe
    ? { keyframes: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 }], interpolation: "linear" }
    : { keyframes: [], interpolation: "linear" },
  downstreamNodeIds: ["node-clip-001-render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const projectFixture = (ready = true): { project: Project; clip: TimelineClip } => {
  const clip: TimelineClip = {
    id: "clip-001",
    name: "Clip 01",
    trackId: "V1",
    start: 0,
    end: 120,
    duration: 120,
    startFrame: 0,
    durationFrames: 120,
    sourceInFrame: 0,
    playbackRate: 1,
    sourceType: "empty",
    linkedWorldId: "world-1",
    clipGraphId: "graph-001",
    cameraPathNodeId: "node-clip-001-trajectory",
    performancePlanNodeId: "node-clip-001-performance",
    cameraTrajectoryNodeId: "node-clip-001-trajectory",
    graphSnapshotId: "graph-001",
    cacheStatus: "invalid",
    variant: "main",
    activeVariantId: "main",
    variants: [{ id: "main", name: "Main", overridePatch: {} }],
  };
  const project: Project = {
    id: "p1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: [clip.id], playhead: 0, visibleRange: [0, 200] } },
    clips: { [clip.id]: clip },
    clipGraphs: {
      "graph-001": {
        id: "graph-001",
        clipId: clip.id,
        rootNodeId: "node-clip-001-clip",
        nodeIds: ["node-clip-001-render", "node-clip-001-trajectory"],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      "node-clip-001-render": renderNode(),
      "node-clip-001-trajectory": cameraPathNode(clip.id, ready),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: {},
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    },
    worlds: {
      "world-1": {
        id: "world-1",
        name: "Cafe World",
        description: "",
        sourceAssetIds: [],
        elements: [],
        createdAt: now,
        updatedAt: now,
        mode: "referenced",
      } as any,
    },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
  return { project, clip };
};

describe("REQUEST_RENDER command", () => {
  it("emits RenderQueued with inverse CANCEL_RENDER when ready", () => {
    const { project, clip } = projectFixture(true);
    const { result } = applyCommand(project, { type: "REQUEST_RENDER", clipId: clip.id, quality: "final" }, { timestamp: now });
    expect(result.ok).toBe(true);
    const queued = result.events.find((e) => e.type === "RenderQueued");
    expect(queued).toBeTruthy();
    expect(queued?.payload.clipId).toBe(clip.id);
    expect(queued?.payload.quality).toBe("final");
    expect(result.inverse?.type).toBe("CANCEL_RENDER");
    expect((result.inverse as any)?.jobId).toBeTruthy();
  });

  it("emits RenderFailed when not ready", () => {
    const { project, clip } = projectFixture(false);
    const { result } = applyCommand(project, { type: "REQUEST_RENDER", clipId: clip.id, quality: "final" }, { timestamp: now });
    const failed = result.events.find((e) => e.type === "RenderFailed");
    expect(result.ok).toBe(true);
    expect(failed).toBeTruthy();
    expect(failed?.payload.clipId).toBe(clip.id);
  });
});

