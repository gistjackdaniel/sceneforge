import type { RenderCacheEntry } from "./types";
import { getDirectionInvalidations, getInvalidationTargets } from "./invalidationRules";
import type { DependencyMap } from "../clipgraph/types";
import type { NodeBase, NodeKind } from "../nodes/types";
import { getAffectedClipIds } from "../dependency/affectedClips";
import type { OutdatedDetection, ProductionOutput } from "../dependency/fingerprint";
import type { RevisionPlan } from "../dependency/recompute";
import { syncClipCacheFields } from "../project/clipCacheStatus";
import type { TimelineClip } from "../../domain/timeline/types";
import {
  mergeDirectionInvalidations,
  type DirectionChannelInvalidation,
} from "../../domain/direction";

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
  directionInvalidations?: DirectionChannelInvalidation[],
): Record<string, RenderCacheEntry> => {
  const affectedClipIds = new Set(getAffectedClipIds(dependencyMap, nodeId));
  const targetKinds = new Set(getInvalidationTargets(nodeKind ?? "RenderSettingsNode"));
  const nextDirectionInvalidations =
    directionInvalidations ?? getDirectionInvalidations(nodeKind ?? "RenderSettingsNode");

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
          directionInvalidations: mergeDirectionInvalidations(
            cache.directionInvalidations,
            nextDirectionInvalidations,
          ),
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
  directionInvalidations?: DirectionChannelInvalidation[],
): Record<string, RenderCacheEntry> =>
  invalidateRelatedCaches(
    caches,
    dependencyMap,
    node.id,
    updatedAt,
    node.kind,
    directionInvalidations,
  );

const invalidateCacheIds = (
  caches: Record<string, RenderCacheEntry>,
  cacheIds: string[],
  nodeIds: string[],
  updatedAt: string,
): Record<string, RenderCacheEntry> => {
  const selected = new Set(cacheIds);
  return Object.fromEntries(
    Object.entries(caches).map(([cacheId, cache]) => {
      if (!selected.has(cacheId)) {
        return [cacheId, cache];
      }
      return [
        cacheId,
        {
          ...cache,
          status: "invalid" as const,
          updatedAt,
          invalidatedByNodeIds: Array.from(new Set([...cache.invalidatedByNodeIds, ...nodeIds])),
        },
      ];
    }),
  );
};

const syncClips = (
  clips: Record<string, TimelineClip> | undefined,
  caches: Record<string, RenderCacheEntry>,
): Record<string, TimelineClip> | undefined => {
  if (!clips) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(clips).map(([clipId, clip]) => [clipId, syncClipCacheFields(clip, caches)]),
  );
};

export interface RevisionCacheUpdate {
  caches: Record<string, RenderCacheEntry>;
  clips?: Record<string, TimelineClip>;
  applied: boolean;
}

/**
 * Apply a revision plan to render caches.
 * Conflict and unresolved plans leave every cache entry untouched.
 * Preserved and hard-locked cache ids are not part of the plan's invalidate set.
 * `TimelineClip.clipGraphId` is copied through; `cacheStatus` is re-derived from proxy/final caches.
 */
export const applyRevisionPlan = (
  caches: Record<string, RenderCacheEntry>,
  plan: RevisionPlan,
  updatedAt: string,
  clips?: Record<string, TimelineClip>,
): RevisionCacheUpdate => {
  if (!plan.ok) {
    return { caches, clips, applied: false };
  }
  const nextCaches = invalidateCacheIds(caches, plan.invalidateCacheIds, plan.invalidateNodeIds, updatedAt);
  return { caches: nextCaches, clips: syncClips(clips, nextCaches), applied: true };
};

/**
 * Invalidate only the caches of outputs whose dependency keys went stale.
 * Fresh outputs and unrelated caches stay valid. Does not mutate the input map.
 */
export const invalidateOutdatedCaches = (
  caches: Record<string, RenderCacheEntry>,
  detection: OutdatedDetection,
  outputs: Pick<ProductionOutput, "outputId" | "cacheId" | "nodeId">[],
  updatedAt: string,
  clips?: Record<string, TimelineClip>,
): RevisionCacheUpdate => {
  if (!detection.ok) {
    return { caches, clips, applied: false };
  }
  const outdatedIds = new Set(detection.outdated.map((item) => item.outputId));
  const selected = outputs.filter((output) => outdatedIds.has(output.outputId));
  const nextCaches = invalidateCacheIds(
    caches,
    selected.map((output) => output.cacheId),
    selected.map((output) => output.nodeId),
    updatedAt,
  );
  return { caches: nextCaches, clips: syncClips(clips, nextCaches), applied: true };
};
