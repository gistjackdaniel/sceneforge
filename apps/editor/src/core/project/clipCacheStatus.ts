import type { CacheStatus, RenderCacheEntry } from "../../domain/rendering/types";
import type { TimelineClip } from "../../domain/timeline/types";

export const deriveClipCacheStatus = (
  clip: Pick<TimelineClip, "proxyCacheId" | "finalCacheId">,
  caches: Record<string, RenderCacheEntry>,
): CacheStatus => {
  const entries = [clip.proxyCacheId, clip.finalCacheId]
    .map((cacheId) => (cacheId ? caches[cacheId] : undefined))
    .filter((entry): entry is RenderCacheEntry => entry !== undefined);

  if (entries.some((entry) => entry.status === "failed")) {
    return "failed";
  }
  if (entries.some((entry) => entry.status === "rendering")) {
    return "rendering";
  }
  if (entries.some((entry) => entry.status === "invalid")) {
    return "invalid";
  }
  if (entries.length === 0) {
    return "invalid";
  }
  return "valid";
};

export const syncClipCacheFields = (
  clip: TimelineClip,
  caches: Record<string, RenderCacheEntry>,
): TimelineClip => ({
  ...clip,
  cacheStatus: deriveClipCacheStatus(clip, caches),
  renderCacheNodeId: clip.proxyCacheId ?? clip.renderCacheNodeId,
});
