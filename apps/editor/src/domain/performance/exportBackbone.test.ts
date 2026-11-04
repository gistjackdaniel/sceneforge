import { describe, it, expect } from "vitest";
import type { Project } from "../project/types";
import { createNodeBase } from "../../application/services/nodeFactory";
import { exportBackboneSmplxForClip } from "./exportBackbone";
import { BackbonePoseValidator } from "../rendering/backboneV01";

const now = "2026-01-01T00:00:00.000Z";

const projectWithPose = (): Project => ({
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
      parameters: {
        actorElementId: "actor-a",
        interpolation: "slerp",
        keyframes: [
          {
            frame: 0,
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
          {
            frame: 10,
            pose: {
              global_orient: [0, 0, Math.PI / 2],
              transl: [0, 0, 0],
              body_pose: Array(63).fill(0),
              left_hand_pose: Array(45).fill(0),
              right_hand_pose: Array(45).fill(0),
              jaw_pose: [0, 0, 0],
              expression: Array(10).fill(0),
            },
          },
        ],
      },
      timestamp: now,
      downstreamNodeIds: ["render"],
    }),
    render: createNodeBase({
      id: "render",
      name: "Render",
      kind: "RenderSettingsNode",
      category: "render",
      parameters: {},
      timestamp: now,
    }),
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

describe("Backbone export from authored SMPL-X", () => {
  it("exports and validates a Backbone v0.1 payload", () => {
    const project = projectWithPose();
    const backbone = exportBackboneSmplxForClip(project, "clip-a", { fps: 16 });
    const parsed = BackbonePoseValidator.validatePose(backbone);
    expect(parsed.humans.length).toBe(1);
    expect(parsed.humans[0].frames.length).toBeGreaterThan(1);
    expect(parsed.version).toBe("0.1");
  });
});

