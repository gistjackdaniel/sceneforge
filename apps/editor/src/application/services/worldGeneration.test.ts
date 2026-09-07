import { describe, expect, it } from "vitest";
import { persistWorldGeneration, registerSourceImageAsset, findReusableWorldExecution, snapshotProjectIdentity } from "./worldGeneration";
import { buildImageToWorldRequest, parseWorldGenerationArtifacts, validateWorldGenerationInput, isSupportedImageFile } from "./worldGenerationRequest";
import { viewportImageUris } from "../../domain/worlds/viewportRepresentation";
import { createLyraModelConnector } from "../../infrastructure/connectors/lyra/modelConnector";
import { createStubLyraAdapter } from "../../core/lyra/stubAdapter";
import type { Project } from "../../domain/project/types";

const emptyProject = (): Project => ({
  id: "p",
  name: "P",
  createdAt: "t",
  updatedAt: "t",
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "s",
  sequences: {},
  clips: {
    "clip-a": {
      id: "clip-a",
      name: "A",
      start: 0,
      end: 48,
      duration: 48,
      sourceType: "empty",
      clipGraphId: "g-a",
      cacheStatus: "valid",
    },
  },
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
    expect(next.worlds["world-gen"].sourceAssetIds).toContain("asset-img");
    expect(next.worlds["world-gen"].previewUri).toBe("artifacts/a/mesh.glb");
    expect(viewportImageUris(next.worlds["world-gen"], next.assets)).toContain("uploads/hero.png");
    expect(next.modelExecutions?.["exec-1"]?.status).toBe("completed");
    expect(Object.values(next.assets).some((asset) => asset.type === "image")).toBe(true);
    expect(Object.values(next.assets).some((asset) => asset.type === "world")).toBe(true);
    expect(next.clips["clip-a"].linkedWorldId).toBeUndefined();
  });

  it("does not mutate the original project object", () => {
    const project = emptyProject();
    const before = snapshotProjectIdentity(project);
    persistWorldGeneration(project, {
      worldId: "world-gen",
      name: "Hero World",
      description: "x",
      execution: {
        id: "exec-1",
        connectorId: "lyra-2.0",
        task: "image_to_world",
        inputAssetIds: [],
        outputAssetIds: [],
        parameters: {},
        startedAt: "t",
        status: "failed",
        errorMessage: "boom",
      },
      artifacts: {},
    });
    expect(snapshotProjectIdentity(project)).toBe(before);
  });
});

describe("world generation request", () => {
  it("requires a single reference image", () => {
    expect(validateWorldGenerationInput({
      referenceAssetIds: [],
      sourceImageUri: "",
      sourceImageName: "",
    }).ok).toBe(false);
    expect(isSupportedImageFile({ type: "text/plain", name: "notes.txt", size: 12 }).ok).toBe(false);
    expect(isSupportedImageFile({ type: "image/png", name: "hero.png", size: 1200 }).ok).toBe(true);
  });

  it("builds image_to_world request without production camera path", () => {
    const request = buildImageToWorldRequest({
      referenceAssetIds: ["asset-img"],
      sourceImageUri: "uploads/hero.png",
      sourceImageName: "hero.png",
      prompt: "warm cafe",
    });
    expect(request.task).toBe("image_to_world");
    expect(request.conditions.filter((item) => item.type === "image")).toHaveLength(1);
    expect(request.backendOptions.explorationTrajectory).toBe(true);
    expect(request.conditions.find((item) => item.type === "camera")?.payload?.role).toBe("generation");
  });

  it("rejects malformed connector artifacts", () => {
    expect(parseWorldGenerationArtifacts({ memoryCoverage: "lots" }).ok).toBe(false);
    expect(parseWorldGenerationArtifacts({ surfaceMeshPath: "a.glb", memoryCoverage: 0.2 }).ok).toBe(true);
  });
});

describe("stub connector generation", () => {
  it("executes a valid image_to_world request", async () => {
    const connector = createLyraModelConnector(createStubLyraAdapter());
    const request = buildImageToWorldRequest({
      referenceAssetIds: ["asset-img"],
      sourceImageUri: "uploads/hero.png",
      sourceImageName: "hero.png",
    });
    const result = await connector.execute(request);
    expect(result.artifacts.surfaceMeshPath).toBeTruthy();
  });

  it("does not persist assets when cancelled", async () => {
    const project = emptyProject();
    const before = snapshotProjectIdentity(project);
    const connector = createLyraModelConnector(createStubLyraAdapter());
    const controller = new AbortController();
    controller.abort();
    const request = buildImageToWorldRequest({
      referenceAssetIds: ["asset-img"],
      sourceImageUri: "uploads/hero.png",
      sourceImageName: "hero.png",
    });
    await expect(connector.execute(request, controller.signal)).rejects.toThrow(/cancelled/i);
    expect(snapshotProjectIdentity(project)).toBe(before);
  });

  it("reuses a completed execution instead of requiring a new run", () => {
    const withWorld = persistWorldGeneration(
      {
        ...emptyProject(),
        assets: registerSourceImageAsset({}, { id: "asset-img", name: "hero.png", uri: "uploads/hero.png" }),
      },
      {
        worldId: "world-gen",
        name: "Hero World",
        description: "restored",
        execution: {
          id: "exec-1",
          connectorId: "lyra-2.0",
          task: "image_to_world",
          inputAssetIds: ["asset-img"],
          outputAssetIds: ["asset-world-gen"],
          parameters: { prompt: "warm cafe" },
          startedAt: "t",
          completedAt: "t",
          status: "completed",
        },
        artifacts: { surfaceMeshPath: "artifacts/a/mesh.glb" },
      },
    );
    const reused = findReusableWorldExecution(withWorld, {
      inputAssetIds: ["asset-img"],
      connectorId: "lyra-2.0",
      task: "image_to_world",
      prompt: "warm cafe",
    });
    expect(reused?.world.id).toBe("world-gen");
    expect(reused?.execution.id).toBe("exec-1");
  });
});
