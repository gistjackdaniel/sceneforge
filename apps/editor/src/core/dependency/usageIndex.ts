import type { ClipGraph, DependencyMap } from "../clipgraph/types";
import type { NodeReference } from "../references/types";

const findClipIdForNode = (
  nodeId: string,
  clipGraphs: Record<string, ClipGraph>,
): string | undefined => {
  for (const graph of Object.values(clipGraphs)) {
    if (graph.nodeIds.includes(nodeId)) {
      return graph.clipId;
    }
  }
  return undefined;
};

/** Map shared library source nodes to clips that reference them. */
export const indexSharedNodeClipUsage = (
  references: Record<string, NodeReference>,
  clipGraphs: Record<string, ClipGraph>,
  clipsByNodeId: Record<string, string[]>,
): Record<string, string[]> => {
  const next = { ...clipsByNodeId };

  Object.values(references).forEach((reference) => {
    const clipId = findClipIdForNode(reference.targetNodeId, clipGraphs);
    if (!clipId) {
      return;
    }
    next[reference.sourceNodeId] = Array.from(
      new Set([...(next[reference.sourceNodeId] ?? []), clipId]),
    );
  });

  return next;
};

export const getClipIdsForNode = (dependencyMap: DependencyMap, nodeId: string): string[] =>
  dependencyMap.clipsByNodeId[nodeId] ?? [];
