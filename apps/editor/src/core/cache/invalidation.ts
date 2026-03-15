import type { RenderCacheEntry } from "./types";
import type { DependencyMap } from "../clipgraph/types";

export const invalidateRelatedCaches = (
  caches: Record<string, RenderCacheEntry>,
  dependencyMap: DependencyMap,
  nodeId: string,
): Record<string, RenderCacheEntry> => {
  const affectedClipIds = new Set(dependencyMap.clipsByNodeId[nodeId] ?? []);
  (dependencyMap.downstreamByNodeId[nodeId] ?? []).forEach((downstreamNodeId) => {
    (dependencyMap.clipsByNodeId[downstreamNodeId] ?? []).forEach((clipId) => {
      affectedClipIds.add(clipId);
    });
  });

  return Object.fromEntries(
    Object.entries(caches).map(([cacheId, cache]) => {
      if (!cache.clipId || !affectedClipIds.has(cache.clipId)) {
        return [cacheId, cache];
      }
      return [
        cacheId,
        {
          ...cache,
          status: "stale",
          invalidatedByNodeIds: Array.from(new Set([...cache.invalidatedByNodeIds, nodeId])),
        },
      ];
    }),
  );
};
