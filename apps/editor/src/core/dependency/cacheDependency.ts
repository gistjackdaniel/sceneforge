import type { ClipGraph } from "../clipgraph/types";
import type { NodeBase } from "../nodes/types";

/** Stable hash of clip graph node recipes used for render cache dependency tracking. */
export const computeClipCacheDependencyHash = (
  clipId: string,
  clipGraphs: Record<string, ClipGraph>,
  nodes: Record<string, NodeBase>,
): string => {
  const graph = Object.values(clipGraphs).find((candidate) => candidate.clipId === clipId);
  if (!graph) {
    return "";
  }

  const payload = graph.nodeIds
    .map((nodeId) => nodes[nodeId])
    .filter((node): node is NodeBase => node !== undefined)
    .map((node) => `${node.id}:${node.version}:${JSON.stringify(node.parameters)}`)
    .sort()
    .join("|");

  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }

  return `clip-${clipId}-${hash.toString(16)}`;
};
