import type { WorldAsset, WorldRepresentation } from "./types";

const inferRepresentation = (world: Partial<WorldAsset>): WorldRepresentation => {
  if (world.representation) {
    return world.representation;
  }
  if (world.proxyKind === "3dgs" || world.visualLayer3dgsPath) {
    return "hybrid";
  }
  if (world.proxyKind === "image") {
    return "image_based_proxy";
  }
  if (world.proxyKind === "usd") {
    return "usd_stage";
  }
  return "hybrid";
};

/** Fill PRD §2.3 manifest fields on legacy WorldAsset payloads. */
export const normalizeWorldAsset = (world: Partial<WorldAsset> & { id: string; name: string }): WorldAsset => {
  const now = new Date().toISOString();
  const rootUri =
    world.rootUri ?? world.previewPath ?? world.usdPath ?? world.surfaceMeshPath ?? `worlds/${world.id}`;
  const previewUri = world.previewUri ?? world.previewPath;
  return {
    id: world.id,
    name: world.name,
    description: world.description ?? "",
    representation: inferRepresentation(world),
    sourceAssetIds: world.sourceAssetIds ?? [],
    rootUri,
    previewUri,
    coordinateSystem: world.coordinateSystem ?? "Y_UP",
    unitScaleMeters: world.unitScaleMeters ?? 1,
    bounds: world.bounds,
    semanticTags: world.semanticTags ?? [],
    generatedBy: world.generatedBy,
    version: world.version ?? world.versions?.length ?? 1,
    createdAt: world.createdAt ?? now,
    updatedAt: world.updatedAt ?? now,
    usdPath: world.usdPath ?? "",
    semanticsPath: world.semanticsPath ?? "",
    navmeshPath: world.navmeshPath ?? "",
    previewPath: world.previewPath ?? previewUri ?? "",
    proxyKind: world.proxyKind ?? "usd",
    elements: world.elements ?? [],
    props: world.props ?? [],
    sourceImageNodeId: world.sourceImageNodeId,
    worldGenerateNodeId: world.worldGenerateNodeId,
    generatedSegmentNodeId: world.generatedSegmentNodeId,
    spatialMemoryNodeId: world.spatialMemoryNodeId,
    visualLayer3dgsPath: world.visualLayer3dgsPath,
    surfaceMeshPath: world.surfaceMeshPath,
    collisionMeshPath: world.collisionMeshPath,
    generatedSegmentPath: world.generatedSegmentPath,
    spatialMemoryPath: world.spatialMemoryPath,
    memoryCoverage: world.memoryCoverage,
    generatedAreaRatio: world.generatedAreaRatio,
    versions: world.versions,
  };
};
