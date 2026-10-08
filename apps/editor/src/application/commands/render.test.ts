import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand } from "./bus";
import type { Project } from "../../domain/project/types";
import type { NodeBase } from "../../domain/graph/types";
import { defaultPorts } from "../../domain/graph/types";

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

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-001"], playhead: 0, visibleRange: [0, 200] } },
  clips: {
    "clip-001": {
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
    } as any,
  },
  clipGraphs: {
    "graph-001": {
      id: "graph-001",
      clipId: "clip-001",
      rootNodeId: "node-clip-001-clip",
      nodeIds: ["node-clip-001-render"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
  },
  nodes: {
    "node-clip-001-render": renderNode(),
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: {},
    clipsByNodeId: {},
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-001": "hash-abc" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("apply REQUEST_RENDER and CANCEL_RENDER", () => {
  it("emits RenderQueued with job details for REQUEST_RENDER", () => {
    const project = projectFixture();
    const executed = executeCommand(
      project,
      emptyCommandBusState(),
      { type: "REQUEST_RENDER", clipId: "clip-001", quality: "final" },
      now,
    );
    expect(executed.result.ok).toBe(true);
    const evt = executed.result.events.find((e) => e.type === "RenderQueued");
    expect(evt).toBeTruthy();
    expect(evt?.payload.clipId).toBe("clip-001");
    expect(evt?.payload.quality).toBe("final");
    expect(typeof evt?.payload.cacheKey).toBe("string");
    expect(typeof evt?.payload.jobId).toBe("string");
  });

  it("emits RenderFailed(cancelled) for CANCEL_RENDER", () => {
    const project = projectFixture();
    const executed = executeCommand(
      project,
      emptyCommandBusState(),
      { type: "CANCEL_RENDER", jobId: "job-final-clip-001-abc" },
      now,
    );
    expect(executed.result.ok).toBe(true);
    const evt = executed.result.events.find((e) => e.type === "RenderFailed");
    expect(evt).toBeTruthy();
    expect(evt?.payload.cancelled).toBe(true);
    expect(evt?.payload.jobId).toBe("job-final-clip-001-abc");
  });
});

