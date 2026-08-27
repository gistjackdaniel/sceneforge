import type { DependencyMap } from "../clipgraph/types";
import type { TimelineClip } from "../project/types";

/** Clips that reference a node directly or via downstream dependencies. */
export const getAffectedClipIds = (
  dependencyMap: DependencyMap,
  nodeId: string,
): string[] => {
  const affected = new Set<string>(dependencyMap.clipsByNodeId[nodeId] ?? []);
  (dependencyMap.downstreamByNodeId[nodeId] ?? []).forEach((downstreamNodeId) => {
    (dependencyMap.clipsByNodeId[downstreamNodeId] ?? []).forEach((clipId) => {
      affected.add(clipId);
    });
  });
  return Array.from(affected);
};

export const getAffectedClips = (
  clips: Record<string, TimelineClip>,
  dependencyMap: DependencyMap,
  nodeId: string,
): TimelineClip[] =>
  getAffectedClipIds(dependencyMap, nodeId)
    .map((clipId) => clips[clipId])
    .filter((clip): clip is TimelineClip => clip !== undefined);
