import type { NodeBase } from "./types";
import { computeNodeContentHash } from "./cacheKey";

/** L1 Node Output Cache (PRD §11.1). Keyed by content hash, not node id. */
export interface NodeOutputCacheEntry {
  contentHash: string;
  nodeId: string;
  value: unknown;
  createdAt: string;
}

export type NodeOutputCacheStore = Record<string, NodeOutputCacheEntry>;

export interface NodeOutputLookup {
  hit: boolean;
  entry?: NodeOutputCacheEntry;
}

export const lookupNodeOutput = (
  cache: NodeOutputCacheStore,
  contentHash: string,
): NodeOutputLookup => {
  const entry = cache[contentHash];
  if (!entry) {
    return { hit: false };
  }
  return { hit: true, entry };
};

export const storeNodeOutput = (
  cache: NodeOutputCacheStore,
  entry: NodeOutputCacheEntry,
): NodeOutputCacheStore => ({
  ...cache,
  [entry.contentHash]: entry,
});

/**
 * Evaluate a node against L1 cache. Identical CacheKeyInput hashes reuse the stored value.
 */
export const evaluateNodeWithCache = (
  cache: NodeOutputCacheStore,
  node: NodeBase,
  compute: () => unknown,
  timestamp: string,
  options?: {
    inputHashes?: string[];
    assetVersionHashes?: string[];
    renderBackendVersion?: string;
  },
): { cache: NodeOutputCacheStore; value: unknown; hit: boolean; contentHash: string } => {
  const contentHash = computeNodeContentHash(node, options);
  const existing = lookupNodeOutput(cache, contentHash);
  if (existing.hit && existing.entry) {
    return { cache, value: existing.entry.value, hit: true, contentHash };
  }
  const value = compute();
  return {
    cache: storeNodeOutput(cache, {
      contentHash,
      nodeId: node.id,
      value,
      createdAt: timestamp,
    }),
    value,
    hit: false,
    contentHash,
  };
};
