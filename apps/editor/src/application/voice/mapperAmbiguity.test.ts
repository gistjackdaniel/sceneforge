import { describe, it, expect } from "vitest";
import { ruleBasedParser } from "../../infrastructure/voice/IntentParser/ruleBasedParser";
import type { Project } from "../../domain/project/types";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { applyCommand } from "../commands/apply";
import { readObjectTrack } from "../../domain/worlds/sceneObjects";
import { mapVoiceIntentToCommands } from "./intentToCommands";
import type { VoiceIntent } from "../ports/IntentParser";
import type { TargetMatch } from "../../domain/worlds/query";

const createProject = (): Project => {
  const now = new Date().toISOString();
  return {
    id: "p1",
    name: "test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "S", clipIds: ["c1"], playhead: 0, visibleRange: [0, 100], fps: 24 } },
    clips: {
      c1: {
        id: "c1",
        name: "C1",
        start: 0,
        end: 100,
        duration: 100,
        startFrame: 0,
        durationFrames: 100,
        sourceInFrame: 0,
        playbackRate: 1,
        sourceType: "empty",
        linkedWorldId: "w1",
        clipGraphId: "g1",
        cameraPathNodeId: "node-c1-trajectory",
        performancePlanNodeId: "node-c1-perf",
        cameraTrajectoryNodeId: "node-c1-trajectory",
        graphSnapshotId: "g1",
        cacheStatus: "invalid",
        variant: "main",
        activeVariantId: "main",
        variants: [{ id: "main", name: "Main", overridePatch: {} }],
      },
    },
    clipGraphs: { g1: { id: "g1", clipId: "c1", rootNodeId: "root", nodeIds: ["node-c1-trajectory"], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes: {
      "node-c1-trajectory": {
        id: "node-c1-trajectory",
        name: "Camera Path",
        kind: "CameraPathNode",
        type: "CameraPathNode",
        category: "cinematic",
        scope: "clip",
        enabled: true,
        tags: [],
        version: 1,
        referenceType: "local",
        parameters: { keyframes: [], interpolation: "linear", frameCount: 120 },
        params: { keyframes: [], interpolation: "linear", frameCount: 120 },
        downstreamNodeIds: ["node-c1-render"],
        inputPorts: [{ id: "in", label: "in", kind: "data" }],
        outputPorts: [{ id: "out", label: "out", kind: "data" }],
        createdAt: now,
        updatedAt: now,
        status: "clean",
      } as any,
    },
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: {
      w1: normalizeWorldAsset({
        id: "w1",
        name: "Room",
        representation: "mesh",
        proxyKind: "usd",
        sourceAssetIds: [],
        rootUri: "/",
        coordinateSystem: "Y_UP",
        unitScaleMeters: 1,
        elements: [
          { id: "e-chair-1", name: "Wooden Chair", kind: "socket", description: "" },
          { id: "e-chair-2", name: "Wooden Chair", kind: "socket", description: "" },
        ],
        usdPath: "",
        semanticsPath: "",
        navmeshPath: "",
        previewPath: "",
      }),
    },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};

describe("intent to command mapper ambiguity/confirmation", () => {
  it("requires confirmation when multiple targets match", () => {
    const project = createProject();
    const parser = ruleBasedParser();
    const intent = parser.parse({ text: "move the wooden chair left 1 meter", locale: "en" })!;
    const matches: TargetMatch[] = [
      { assetId: "world-A", kind: "location", displayName: "Room A", score: 92 },
      { assetId: "world-B", kind: "location", displayName: "Room B", score: 90 },
    ];
    const result = mapVoiceIntentToCommands(intent, matches, {
      project,
      clipId: "c1",
      tSeconds: 1.0,
    });
    expect(result.commands.length).toBe(0);
    expect(result.confirmation?.reason).toBe("ambiguous");
    expect(result.confirmation?.options?.length).toBeGreaterThan(1);
  });
});

const moveIntent = (): VoiceIntent => ({
  verb: "move",
  targetRefs: [],
  params: { direction: "left", amount: 1 },
  confidence: 1,
  locale: "en",
});

describe("voice keyframe frame index", () => {
  it("stores a 2.5s camera move at frame 60 when the shot is 24fps", () => {
    const project = createProject();
    const result = mapVoiceIntentToCommands(moveIntent(), [], {
      project,
      clipId: "c1",
      tSeconds: 2.5,
    });
    expect(result.commands).toHaveLength(1);
    const command = result.commands[0];
    expect(command?.type).toBe("UPDATE_CAMERA_KEYFRAME");
    if (command?.type !== "UPDATE_CAMERA_KEYFRAME") {
      return;
    }
    expect(command.t).toBe(60);
    const applied = applyCommand(project, command, { timestamp: "2026-11-04T00:00:00.000Z" });
    expect(applied.result.ok).toBe(true);
    const stored = cameraPathParamsFromNode(applied.project.nodes["node-c1-trajectory"].parameters);
    expect(stored.keyframes.map((key) => key.frame)).toEqual([60]);
  });

  it("uses Shot.fps when it is not 24", () => {
    const project = createProject();
    project.sequences.seq.fps = 30;
    const result = mapVoiceIntentToCommands(moveIntent(), [], {
      project,
      clipId: "c1",
      tSeconds: 2,
    });
    const command = result.commands[0];
    expect(command?.type).toBe("UPDATE_CAMERA_KEYFRAME");
    if (command?.type !== "UPDATE_CAMERA_KEYFRAME") {
      return;
    }
    expect(command.t).toBe(60);
  });

  it("falls back to the default fps when the shot has none", () => {
    const project = createProject();
    project.sequences.seq.fps = undefined;
    const result = mapVoiceIntentToCommands(moveIntent(), [], {
      project,
      clipId: "c1",
      tSeconds: 2,
    });
    const command = result.commands[0];
    expect(command?.type).toBe("UPDATE_CAMERA_KEYFRAME");
    if (command?.type !== "UPDATE_CAMERA_KEYFRAME") {
      return;
    }
    expect(command.t).toBe(48);
  });

  it("writes an object pose keyframe at the converted frame", () => {
    const project = createProject();
    const result = mapVoiceIntentToCommands(moveIntent(), [
      { assetId: "e-chair-1", kind: "prop", displayName: "Wooden Chair", score: 1 },
    ], {
      project,
      clipId: "c1",
      tSeconds: 2.5,
    });
    const command = result.commands[0];
    expect(command?.type).toBe("CREATE_NODE");
    if (command?.type !== "CREATE_NODE") {
      return;
    }
    expect(readObjectTrack(command.node.parameters)?.keyframes.map((key) => key.frame)).toEqual([60]);
  });
});

