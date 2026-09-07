import { createAssetRecord, registerAsset } from "../assets/registry";
import type { AssetRecord } from "../assets/types";
import type { ModelExecutionRecord } from "./modelExecution";
import type { WorldAsset } from "./types";
import { normalizeWorldAsset } from "./normalize";

export interface PackagedWorldResult {
  world: WorldAsset;
  assets: Record<string, AssetRecord>;
  execution: ModelExecutionRecord;
}

/**
 * Package connector artifacts into WorldAsset + Asset registry (PRD §12.4, Phase 6).
 * Does not re-invoke the generative model.
 */
export const packageWorldFromExecution = (input: {
  worldId: string;
  name: string;
  description: string;
  execution: ModelExecutionRecord;
  artifacts: {
    generatedSegmentPath?: string;
    spatialMemoryPath?: string;
    visualLayer3dgsPath?: string;
    surfaceMeshPath?: string;
    navmeshPath?: string;
    collisionMeshPath?: string;
    memoryCoverage?: number;
    generatedAreaRatio?: number;
  };
  existingWorld?: WorldAsset;
  existingAssets: Record<string, AssetRecord>;
}): PackagedWorldResult => {
  const now = input.execution.completedAt ?? new Date().toISOString();
  let assets = { ...input.existingAssets };
  const outputIds: string[] = [...input.execution.outputAssetIds];

  const registerOutput = (id: string, type: AssetRecord["type"], name: string, uri: string) => {
    if (!uri) {
      return;
    }
    const asset = createAssetRecord({
      id,
      type,
      name,
      uri,
      metadata: { worldId: input.worldId, executionId: input.execution.id },
    });
    assets = registerAsset(assets, asset);
    if (!outputIds.includes(asset.id)) {
      outputIds.push(asset.id);
    }
  };

  registerOutput(
    `asset-${input.worldId}-segment`,
    "video",
    `${input.name} Segment`,
    input.artifacts.generatedSegmentPath ?? "",
  );
  registerOutput(
    `asset-${input.worldId}-mesh`,
    "mesh",
    `${input.name} Mesh`,
    input.artifacts.surfaceMeshPath ?? "",
  );
  registerOutput(
    `asset-${input.worldId}-splat`,
    "generated_proxy",
    `${input.name} 3DGS`,
    input.artifacts.visualLayer3dgsPath ?? "",
  );

  const world = normalizeWorldAsset({
    ...(input.existingWorld ?? { id: input.worldId, name: input.name }),
    id: input.worldId,
    name: input.name,
    description: input.description,
    generatedBy: { ...input.execution, outputAssetIds: outputIds },
    visualLayer3dgsPath: input.artifacts.visualLayer3dgsPath,
    surfaceMeshPath: input.artifacts.surfaceMeshPath,
    collisionMeshPath: input.artifacts.collisionMeshPath,
    generatedSegmentPath: input.artifacts.generatedSegmentPath,
    spatialMemoryPath: input.artifacts.spatialMemoryPath,
    navmeshPath: input.artifacts.navmeshPath ?? input.existingWorld?.navmeshPath ?? "",
    memoryCoverage: input.artifacts.memoryCoverage,
    generatedAreaRatio: input.artifacts.generatedAreaRatio,
    previewPath: input.artifacts.surfaceMeshPath ?? input.existingWorld?.previewPath ?? "",
    rootUri: input.artifacts.surfaceMeshPath || `worlds/${input.worldId}`,
    previewUri: input.artifacts.surfaceMeshPath,
    representation: "hybrid",
    proxyKind: "3dgs",
    updatedAt: now,
  });

  const worldAsset = createAssetRecord({
    id: `asset-${world.id}`,
    type: "world",
    name: world.name,
    uri: world.rootUri,
    thumbnailUri: world.previewUri,
    semanticTags: world.semanticTags,
    metadata: { worldId: world.id, executionId: input.execution.id },
  });
  assets = registerAsset(assets, worldAsset);
  if (!outputIds.includes(worldAsset.id)) {
    outputIds.push(worldAsset.id);
  }

  const nextWorld: WorldAsset = {
    ...world,
    sourceAssetIds: Array.from(
      new Set([
        ...world.sourceAssetIds,
        worldAsset.id,
        ...input.execution.inputAssetIds.filter((id) => assets[id]?.type === "image"),
      ]),
    ),
    generatedBy: { ...input.execution, outputAssetIds: outputIds },
  };

  return {
    world: nextWorld,
    assets,
    execution: { ...input.execution, outputAssetIds: outputIds },
  };
};
