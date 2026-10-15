import { describe, it, expect } from "vitest";
import { projectStateResolver } from "../../infrastructure/voice/TargetResolver/projectStateResolver";
import type { Project } from "../../domain/project/types";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";

const createProject = (): Project => {
  const now = new Date().toISOString();
  return {
    id: "p1",
    name: "test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "S", clipIds: ["c1"], playhead: 0, visibleRange: [0, 100] } },
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
    clipGraphs: { g1: { id: "g1", clipId: "c1", rootNodeId: "root", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes: {},
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
          { id: "e-actor-1", name: "Man A", kind: "actor_mark", description: "" },
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

describe("projectStateResolver", () => {
  it("prefers selection for pronoun 'it'", () => {
    const project = createProject();
    const resolver = projectStateResolver(project);
    const results = resolver.resolve("it", { selectionIds: ["e-actor-1"] });
    expect(results[0]?.assetId).toBe("e-actor-1");
    expect(results[0]?.score).toBeGreaterThan(0.9);
  });

  it("returns multiple matches for ambiguous common names", () => {
    const project = createProject();
    const resolver = projectStateResolver(project);
    const results = resolver.resolve("wooden chair", { });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});

