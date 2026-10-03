import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "./AgentOrchestrator";
import type { Project } from "../../../domain/project/types";
import type { NodeBase } from "../../../domain/graph/types";
import { defaultPorts } from "../../../domain/graph/types";
import type { TimelineClip } from "../../../domain/timeline/types";

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

const cameraPathNode = (clipId: string): NodeBase => ({
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
  parameters: { keyframes: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 }], interpolation: "linear" },
  params: { keyframes: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 }], interpolation: "linear" },
  downstreamNodeIds: ["node-clip-001-render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const projectFixture = (): { project: Project; clip: TimelineClip } => {
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
      "node-clip-001-trajectory": cameraPathNode(clip.id),
    },
    references: {},
    dependencyMap: {
      downstreamByNodeId: {},
      clipsByNodeId: {},
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    },
    worlds: { "world-1": { id: "world-1", name: "Cafe World", description: "", sourceAssetIds: [], elements: [], createdAt: now, updatedAt: now, mode: "referenced" } as any },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
  return { project, clip };
};

describe("AgentOrchestrator", () => {
  it("maps CU shot preset to CREATE_NODE + CONNECT_NODES", () => {
    const { project, clip } = projectFixture();
    const plan = AgentOrchestrator.plan("apply_shot_preset", { project, selectedClip: clip });
    expect(plan.commands.length).toBeGreaterThanOrEqual(1);
    expect(plan.commands[0].type).toBe("CREATE_NODE");
    expect(plan.commands[0].type === "CREATE_NODE" && plan.commands[0].node.kind).toBe("ShotPresetNode");
  });

  it("requires confirmation for render when ready", () => {
    const { project, clip } = projectFixture();
    const plan = AgentOrchestrator.plan("render_shot", { project, selectedClip: clip });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.confirmTitle).toBeTruthy();
  });

  it("gates render when not ready", () => {
    const { project, clip } = projectFixture();
    // Remove camera keyframes to force not-ready
    (project.nodes["node-clip-001-trajectory"] as any).parameters = { keyframes: [], interpolation: "linear" };
    const plan = AgentOrchestrator.plan("render_shot", { project, selectedClip: clip });
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.notes && plan.notes.length).toBeGreaterThan(0);
  });
});

