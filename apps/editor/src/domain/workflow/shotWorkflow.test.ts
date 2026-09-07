import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase, type NodeKind } from "../graph/types";
import type { ClipGraph } from "../project/clipGraph";
import type { TimelineClip } from "../timeline/types";
import type { WorldAsset } from "../worlds/types";
import { evaluateShotWorkflow } from "./shotWorkflow";

const node = (id: string, kind: NodeKind, parameters: Record<string, unknown>): NodeBase => ({
  id,
  name: id,
  kind,
  type: kind,
  category: kind === "PerformancePlanNode" ? "performance" : "cinematic",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters,
  params: parameters,
  downstreamNodeIds: [],
  status: "clean",
  ...defaultPorts(),
  createdAt: "t",
  updatedAt: "t",
});

const clip: TimelineClip = {
  id: "clip-1",
  name: "Shot 010",
  start: 0,
  end: 48,
  duration: 48,
  startFrame: 0,
  durationFrames: 48,
  sourceType: "empty",
  linkedWorldId: "world-1",
  clipGraphId: "graph-1",
  cameraPathNodeId: "camera",
  performancePlanNodeId: "performance",
  cacheStatus: "invalid",
};

const graph: ClipGraph = {
  id: "graph-1",
  clipId: clip.id,
  rootNodeId: "root",
  nodeIds: ["root", "camera", "performance"],
  edges: [],
  previewFrames: [],
  finalFrames: [],
  keyframeNodeIds: [],
};

const world = { id: "world-1", name: "Room" } as WorldAsset;

const nodesWith = (
  cameraKeyframes: unknown[] = [],
  performance: Record<string, unknown> = {},
  extra: Record<string, NodeBase> = {},
): Record<string, NodeBase> => ({
  root: node("root", "TimelineClipNode", {}),
  camera: node("camera", "CameraPathNode", { keyframes: cameraKeyframes }),
  performance: node("performance", "PerformancePlanNode", performance),
  ...extra,
});

describe("shot workflow readiness", () => {
  it("sends a new environment shot to camera recording after a world is assigned", () => {
    const result = evaluateShotWorkflow({
      clip,
      graph,
      nodes: nodesWith(),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(false);
    expect(result.nextStepId).toBe("camera");
    expect(result.steps.find((step) => step.id === "stage")?.state).toBe("optional");
    expect(result.blockingIssues).toEqual(["Record at least one camera keyframe."]);
  });

  it("allows a camera-authored environment shot to render without performance", () => {
    const result = evaluateShotWorkflow({
      clip,
      graph,
      nodes: nodesWith([{ frame: 0, position: [0, 1, 4], rotation: [0, 0, 0, 1] }]),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(true);
    expect(result.nextStepId).toBe("render");
    expect(result.steps.find((step) => step.id === "performance")?.state).toBe("optional");
  });

  it("requires staged actors when performance direction is authored", () => {
    const result = evaluateShotWorkflow({
      clip,
      graph,
      nodes: nodesWith(
        [{ frame: 0, position: [0, 1, 4], rotation: [0, 0, 0, 1] }],
        {
          sources: [{ id: "take", type: "live_action", label: "Take", uri: "take.mov", enabled: true }],
          cues: [{ id: "react", kind: "reaction", label: "React", direction: "Glance back.", startFrame: 4, endFrame: 12 }],
        },
      ),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(false);
    expect(result.nextStepId).toBe("stage");
    expect(result.blockingIssues[0]).toContain("no actor is staged");
  });

  it("requires edited audio when dialogue timing is authored", () => {
    const actor = node("actor", "ActorPlacementNode", {
      worldElementId: "actor-a",
      position: { x: 0, y: 0, z: 0 },
    });
    const actorGraph = { ...graph, nodeIds: [...graph.nodeIds, actor.id] };
    const result = evaluateShotWorkflow({
      clip,
      graph: actorGraph,
      nodes: nodesWith(
        [{ frame: 0, position: [0, 1, 4], rotation: [0, 0, 0, 1] }],
        {
          sources: [{ id: "text", type: "text_prompt", label: "Acting", notes: "Dry delivery.", enabled: true }],
          cues: [{ id: "line", kind: "dialogue", label: "Line", direction: "Finish dry.", startFrame: 4, endFrame: 12, actorId: "actor-a" }],
        },
        { actor },
      ),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(false);
    expect(result.nextStepId).toBe("performance");
    expect(result.blockingIssues).toContain("Dialogue cues require an edited audio guide for frame-accurate timing.");
  });

  it("starts with world selection when the linked world is missing", () => {
    const result = evaluateShotWorkflow({
      clip: { ...clip, linkedWorldId: undefined },
      graph,
      nodes: nodesWith([{ frame: 0, position: [0, 1, 4], rotation: [0, 0, 0, 1] }]),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(false);
    expect(result.nextStepId).toBe("world");
  });

  it("treats a follow-up shot that already shares a world as camera-next", () => {
    const result = evaluateShotWorkflow({
      clip: { ...clip, name: "Empty Clip 2", linkedWorldId: world.id },
      graph,
      nodes: nodesWith(),
      worlds: { [world.id]: world },
      caches: {},
    });

    expect(result.readyForRender).toBe(false);
    expect(result.nextStepId).toBe("camera");
    expect(result.steps.find((step) => step.id === "world")?.state).toBe("done");
    expect(result.steps.find((step) => step.id === "stage")?.state).toBe("optional");
    expect(result.steps.find((step) => step.id === "performance")?.state).toBe("optional");
  });
});

