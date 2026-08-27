import type { LyraWorldGenerateOutput } from "../lyra/types";
import { assetFromWorld } from "../../domain/assets/registry";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import type { WorldAsset } from "../../domain/worlds/types";
import type { AssetRecord } from "../../domain/assets/types";

export interface WorldArtifactRegistryEntry {
  worldId: string;
  version: number;
  jobId: string;
  artifacts: LyraWorldGenerateOutput;
  registeredAt: string;
}

export const registerWorldFromLyraOutput = (
  input: {
    worldId: string;
    name: string;
    description: string;
    jobId: string;
    nodeIds: {
      sourceImageNodeId: string;
      worldGenerateNodeId: string;
      generatedSegmentNodeId: string;
      spatialMemoryNodeId: string;
    };
  },
  output: LyraWorldGenerateOutput,
  existing?: WorldAsset,
): WorldAsset => {
  const version = (existing?.versions?.length ?? 0) + 1;
  const now = new Date().toISOString();
  return normalizeWorldAsset({
    id: input.worldId,
    name: input.name,
    description: input.description,
    usdPath: existing?.usdPath ?? "",
    semanticsPath: existing?.semanticsPath ?? "",
    navmeshPath: output.navmeshPath ?? existing?.navmeshPath ?? "",
    previewPath: output.surfaceMeshPath,
    proxyKind: "3dgs",
    representation: "hybrid",
    elements: existing?.elements ?? [],
    props: existing?.props ?? [],
    sourceImageNodeId: input.nodeIds.sourceImageNodeId,
    worldGenerateNodeId: input.nodeIds.worldGenerateNodeId,
    generatedSegmentNodeId: input.nodeIds.generatedSegmentNodeId,
    spatialMemoryNodeId: input.nodeIds.spatialMemoryNodeId,
    visualLayer3dgsPath: output.visualLayer3dgsPath,
    surfaceMeshPath: output.surfaceMeshPath,
    collisionMeshPath: output.collisionMeshPath,
    generatedSegmentPath: output.generatedSegmentPath,
    spatialMemoryPath: output.spatialMemoryPath,
    memoryCoverage: output.memoryCoverage,
    generatedAreaRatio: output.generatedAreaRatio,
    rootUri: output.surfaceMeshPath || `worlds/${input.worldId}`,
    previewUri: output.surfaceMeshPath,
    version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    versions: [
      ...(existing?.versions ?? []),
      {
        version,
        jobId: input.jobId,
        registeredAt: now,
        artifacts: output,
      },
    ],
  });
};

export const registerWorldAssetPair = (
  world: WorldAsset,
  assets: Record<string, AssetRecord>,
): { world: WorldAsset; assets: Record<string, AssetRecord> } => {
  const asset = assetFromWorld(world);
  const nextWorld = world.sourceAssetIds.includes(asset.id)
    ? world
    : { ...world, sourceAssetIds: [...world.sourceAssetIds, asset.id] };
  return {
    world: nextWorld,
    assets: { ...assets, [asset.id]: asset },
  };
};
