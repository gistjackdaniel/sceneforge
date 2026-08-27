import type { GraphEdge } from "./types";
import { edgeSourceId, edgeTargetId } from "./types";

export interface AcyclicValidationResult {
  ok: boolean;
  cyclePath?: string[];
}

/**
 * Validates that the directed graph formed by edges is a DAG.
 * Cycle detection via DFS three-color marking.
 */
export const validateAcyclic = (edges: GraphEdge[]): AcyclicValidationResult => {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edgeSourceId(edge);
    const to = edgeTargetId(edge);
    if (!from || !to) {
      continue;
    }
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
    if (!adjacency.has(to)) {
      adjacency.set(to, []);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const nodeId of adjacency.keys()) {
    color.set(nodeId, WHITE);
    parent.set(nodeId, null);
  }

  const rebuildCycle = (start: string, end: string): string[] => {
    const path = [end, start];
    let current: string | null | undefined = parent.get(start);
    while (current && current !== end) {
      path.push(current);
      current = parent.get(current);
    }
    path.push(end);
    return path.reverse();
  };

  const visit = (nodeId: string): AcyclicValidationResult => {
    color.set(nodeId, GRAY);
    for (const next of adjacency.get(nodeId) ?? []) {
      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === GRAY) {
        return { ok: false, cyclePath: rebuildCycle(nodeId, next) };
      }
      if (nextColor === WHITE) {
        parent.set(next, nodeId);
        const result = visit(next);
        if (!result.ok) {
          return result;
        }
      }
    }
    color.set(nodeId, BLACK);
    return { ok: true };
  };

  for (const nodeId of adjacency.keys()) {
    if ((color.get(nodeId) ?? WHITE) === WHITE) {
      const result = visit(nodeId);
      if (!result.ok) {
        return result;
      }
    }
  }
  return { ok: true };
};
