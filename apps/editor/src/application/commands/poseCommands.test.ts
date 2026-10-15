import { describe, it, expect } from "vitest";
import { emptyCommandBusState, executeCommand, undoCommand, redoCommand } from "./bus";
import type { Project } from "../../domain/project/types";
import type { NodeBase } from "../../domain/graph/types";
import { createNodeBase } from "../services/nodeFactory";

const now = "2026-01-01T00:00:00.000Z";

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a"], playhead: 0, visibleRange: [0, 200] } },
  clips: {
    "clip-a": { id: "clip-a", name: "A", start: 0, end: 48, duration: 48, startFrame: 0, durationFrames: 48, sourceType: "empty", clipGraphId: "g-a", cacheStatus: "valid" },
  },
  clipGraphs: { "g-a": { id: "g-a", clipId: "clip-a", rootNodeId: "render", nodeIds: ["pose", "render"], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
  nodes: {
    pose: createNodeBase({
      id: "pose",
      name: "Actor Pose",
      kind: "ActorPoseNode",
      category: "performance",
      parameters: { actorElementId: "actor-a", interpolation: "slerp", keyframes: [] },
      timestamp: now,
      downstreamNodeIds: ["render"],
    }) as NodeBase,
    render: createNodeBase({
      id: "render",
      name: "Render",
      kind: "RenderSettingsNode",
      category: "render",
      parameters: {},
      timestamp: now,
    }) as NodeBase,
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: { pose: ["render"], render: [] },
    clipsByNodeId: { pose: ["clip-a"], render: ["clip-a"] },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-a": "ha" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("pose authoring commands", () => {
  it("adds, undoes, and redoes a keyframe", () => {
    const project = projectFixture();
    const bus = emptyCommandBusState();
    const add = executeCommand(
      project,
      bus,
      {
        type: "ADD_POSE_KEYFRAME",
        nodeId: "pose",
        frame: 12,
        pose: {
          global_orient: [0, 0, 0],
          transl: [0, 0, 0],
          body_pose: Array(63).fill(0),
          left_hand_pose: Array(45).fill(0),
          right_hand_pose: Array(45).fill(0),
          jaw_pose: [0, 0, 0],
          expression: Array(10).fill(0),
        },
      },
      now,
    );
    expect(add.result.ok).toBe(true);
    const kfs = (add.project.nodes.pose.parameters as any).keyframes as Array<{ frame: number }>;
    expect(kfs.find((k) => k.frame === 12)).toBeTruthy();
    const undone = undoCommand(add.project, add.bus, now);
    const kfsAfterUndo = (undone.project.nodes.pose.parameters as any).keyframes as Array<{ frame: number }>;
    expect(kfsAfterUndo.find((k) => k.frame === 12)).toBeFalsy();
    const redone = redoCommand(undone.project, undone.bus, now);
    const kfsAfterRedo = (redone.project.nodes.pose.parameters as any).keyframes as Array<{ frame: number }>;
    expect(kfsAfterRedo.find((k) => k.frame === 12)).toBeTruthy();
  });

  it("applies a preset at a frame", () => {
    const project = projectFixture();
    const executed = executeCommand(
      project,
      emptyCommandBusState(),
      { type: "APPLY_POSE_PRESET", nodeId: "pose", frame: 0, presetId: "t_pose" },
      now,
    );
    expect(executed.result.ok).toBe(true);
    const frames = (executed.project.nodes.pose.parameters as any).keyframes as Array<{ frame: number; pose: { body_pose: number[] } }>;
    expect(frames[0]?.pose?.body_pose?.length).toBe(63);
  });
});

