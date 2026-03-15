export type CacheStatus = "idle" | "ready" | "stale" | "rendering" | "failed";

export type CacheKind = "proxy" | "final" | "world_reconstruction" | "node_evaluation";

export interface RenderCacheEntry {
  id: string;
  clipId?: string;
  nodeId?: string;
  label: string;
  kind: CacheKind;
  status: CacheStatus;
  updatedAt: string;
  invalidatedByNodeIds: string[];
  connectorId?: string;
  previewText?: string;
}
