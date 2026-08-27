export type CacheStatus = "valid" | "invalid" | "rendering" | "failed";

export type CacheKind =
  | "proxy"
  | "final"
  | "world_reconstruction"
  | "node_evaluation"
  | "generated_segment"
  | "spatial_memory"
  | "stage_render_pass";

export interface RenderCacheEntry {
  id: string;
  clipId?: string;
  nodeId?: string;
  label: string;
  kind: CacheKind;
  status: CacheStatus;
  updatedAt: string;
  invalidatedByNodeIds: string[];
  dependencyHash?: string;
  artifactPath?: string;
  connectorId?: string;
  previewText?: string;
}

/** Legacy persisted values → spec-aligned cache status. */
export const normalizeCacheStatus = (value: string): CacheStatus => {
  if (value === "idle" || value === "ready") {
    return "valid";
  }
  if (value === "stale") {
    return "invalid";
  }
  if (value === "valid" || value === "invalid" || value === "rendering" || value === "failed") {
    return value;
  }
  return "invalid";
};
