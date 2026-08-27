import type { AssetRecord, AssetType } from "./types";

const simpleHash = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const createAssetRecord = (input: {
  id: string;
  type: AssetType;
  name: string;
  uri: string;
  thumbnailUri?: string;
  metadata?: Record<string, unknown>;
  semanticTags?: string[];
  version?: number;
  parentVersionId?: string;
  contentHash?: string;
  createdAt?: string;
  updatedAt?: string;
}): AssetRecord => {
  const now = new Date().toISOString();
  const contentHash =
    input.contentHash ?? simpleHash(`${input.type}:${input.uri}:${input.version ?? 1}`);
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    uri: input.uri,
    thumbnailUri: input.thumbnailUri,
    contentHash,
    metadata: input.metadata ?? {},
    semanticTags: input.semanticTags ?? [],
    version: input.version ?? 1,
    parentVersionId: input.parentVersionId,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
};

export const registerAsset = (
  assets: Record<string, AssetRecord>,
  asset: AssetRecord,
): Record<string, AssetRecord> => ({
  ...assets,
  [asset.id]: asset,
});

export const assetFromWorld = (world: {
  id: string;
  name: string;
  rootUri: string;
  previewUri?: string;
  semanticTags?: string[];
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}): AssetRecord =>
  createAssetRecord({
    id: `asset-${world.id}`,
    type: "world",
    name: world.name,
    uri: world.rootUri,
    thumbnailUri: world.previewUri,
    semanticTags: world.semanticTags,
    version: world.version,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    metadata: { worldId: world.id },
  });
