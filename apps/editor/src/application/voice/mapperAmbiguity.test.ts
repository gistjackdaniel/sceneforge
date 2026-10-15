import { describe, it, expect } from "vitest";
import { ruleBasedParser } from "../../infrastructure/voice/IntentParser/ruleBasedParser";
import { projectStateResolver } from "../../infrastructure/voice/TargetResolver/projectStateResolver";
import type { Project } from "../../domain/project/types";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import { mapVoiceIntentToCommands } from "./intentToCommands";

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
    const resolver = projectStateResolver(project);
    const parser = ruleBasedParser();
    const intent = parser.parse({ text: "move the wooden chair left 1 meter", locale: "en" })!;
    const matches = resolver.resolve(intent.targetRefs[0], {});
    const result = mapVoiceIntentToCommands(intent, matches, {
      project,
      clipId: "c1",
      tSeconds: 1.0,
      fps: 24,
    });
    expect(result.commands.length).toBe(0);
    expect(result.confirmation?.reason).toBe("ambiguous");
    expect(result.confirmation?.options?.length).toBeGreaterThan(1);
  });
});

