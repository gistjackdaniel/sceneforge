import { describe, expect, it } from "vitest";
import { persistWorldGeneration, registerSourceImageAsset } from "./worldGeneration";
import type { Project } from "../../domain/project/types";

const emptyProject = (): Project => ({
  id: "p",
  name: "P",
  createdAt: "t",
  updatedAt: "t",
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "s",
  sequences: {},
  clips: {},
  clipGraphs: {},
  nodes: {},
  references: {},
  dependencyMap: {
    downstreamByNodeId: {},
    clipsByNodeId: {},
    referencesByNodeId: {},
    cacheHashesByClipId: {},
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
  modelExecutions: {},
});

describe("persistWorldGeneration", () => {
  it("registers world + output assets and execution record without calling a model", () => {
    const withImage = {
      ...emptyProject(),
      assets: registerSourceImageAsset({}, { id: "asset-img", name: "hero.png", uri: "uploads/hero.png" }),
    };
    const next = persistWorldGeneration(withImage, {
      worldId: "world-gen",
      name: "Hero World",
      description: "restored",
      execution: {
        id: "exec-1",
        connectorId: "lyra-2.0",
        task: "image_to_world",
        inputAssetIds: ["asset-img"],
        outputAssetIds: [],
        parameters: { seed: 1 },
        startedAt: "t",
        completedAt: "t",
        status: "completed",
      },
      artifacts: {
        generatedSegmentPath: "artifacts/a/seg.mp4",
        spatialMemoryPath: "artifacts/a/mem/",
        visualLayer3dgsPath: "artifacts/a/scene.ply",
        surfaceMeshPath: "artifacts/a/mesh.glb",
        memoryCoverage: 0.78,
      },
    });
    expect(next.worlds["world-gen"]).toBeTruthy();
    expect(next.worlds["world-gen"].generatedBy?.id).toBe("exec-1");
    expect(next.modelExecutions?.["exec-1"]?.status).toBe("completed");
    expect(Object.values(next.assets).some((asset) => asset.type === "image")).toBe(true);
    expect(Object.values(next.assets).some((asset) => asset.type === "world")).toBe(true);
  });
});
