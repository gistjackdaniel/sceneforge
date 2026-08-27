export type AssetType =
  | "image"
  | "video"
  | "audio"
  | "mesh"
  | "material"
  | "texture"
  | "actor"
  | "prop"
  | "environment"
  | "animation"
  | "camera_preset"
  | "lighting_preset"
  | "world"
  | "generated_proxy";

/** Reusable data shared across clips and graphs. Distinct from GraphNode. */
export interface AssetRecord {
  id: string;
  type: AssetType;
  name: string;

  uri: string;
  thumbnailUri?: string;

  contentHash: string;
  metadata: Record<string, unknown>;
  semanticTags: string[];

  version: number;
  parentVersionId?: string;

  createdAt: string;
  updatedAt: string;
}
