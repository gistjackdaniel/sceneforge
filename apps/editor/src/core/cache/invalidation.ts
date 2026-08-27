import type { RenderCacheEntry } from "./types";
import { getInvalidationTargets } from "./invalidationRules";
import type { DependencyMap } from "../clipgraph/types";
import type { NodeBase, NodeKind } from "../nodes/types";
import { getAffectedClipIds } from "../dependency/affectedClips";

/**
 * Invalidate caches affected by a node change, scoped by node kind rules.
 * Downstream clip caches matching the invalidation target kinds are marked invalid.
 */
export const invalidateRelatedCaches = (
  caches: Record<string, RenderCacheEntry>,
  dependencyMap: DependencyMap,
  nodeId: string,
  updatedAt: string,
  nodeKind?: NodeKind,
): Record<string, RenderCacheEntry> => {
  const affectedClipIds = new Set(getAffectedClipIds(dependencyMap, nodeId));
  const targetKinds = new Set(getInvalidationTargets(nodeKind ?? "RenderSettingsNode"));

  return Object.fromEntries(
    Object.entries(caches).map(([cacheId, cache]) => {
      if (!cache.clipId || !affectedClipIds.has(cache.clipId)) {
        return [cacheId, cache];
      }
      if (!targetKinds.has(cache.kind)) {
        return [cacheId, cache];
      }
      return [
        cacheId,
        {
          ...cache,
          status: "invalid" as const,
          updatedAt,
          invalidatedByNodeIds: Array.from(new Set([...cache.invalidatedByNodeIds, nodeId])),
        },
      ];
    }),
  );
};

export const invalidateCachesForNodeChange = (
  caches: Record<string, RenderCacheEntry>,
  dependencyMap: DependencyMap,
  node: NodeBase,
  updatedAt: string,
): Record<string, RenderCacheEntry> =>
  invalidateRelatedCaches(caches, dependencyMap, node.id, updatedAt, node.kind);
