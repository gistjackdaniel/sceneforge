import type { GraphEdge } from "./types";
import { edgeSourceId, edgeTargetId } from "./types";

export interface TopoSortResult {
  ok: boolean;
  order: string[];
  remaining?: string[];
}

/**
 * Kahn topological sort. Isolated node ids are included in a stable order.
 */
export const topologicalSort = (nodeIds: string[], edges: GraphEdge[]): TopoSortResult => {
  const uniqueIds = Array.from(new Set(nodeIds));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  uniqueIds.forEach((id) => {
    indegree.set(id, 0);
    adjacency.set(id, []);
  });

  for (const edge of edges) {
    const from = edgeSourceId(edge);
    const to = edgeTargetId(edge);
    if (!from || !to || !indegree.has(from) || !indegree.has(to)) {
      continue;
    }
    adjacency.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const queue = uniqueIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    const nextIds = [...(adjacency.get(current) ?? [])].sort();
    for (const next of nextIds) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  if (order.length !== uniqueIds.length) {
    return {
      ok: false,
      order,
      remaining: uniqueIds.filter((id) => !order.includes(id)),
    };
  }
  return { ok: true, order };
};
