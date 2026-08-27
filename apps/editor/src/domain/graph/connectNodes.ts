import type { GraphEdge } from "./types";
import { normalizeGraphEdge } from "./types";
import { validateAcyclic } from "./validateAcyclic";

export interface ConnectNodesResult {
  ok: boolean;
  edges?: GraphEdge[];
  reason?: string;
  cyclePath?: string[];
}

/** Append an edge only if the resulting graph remains acyclic. */
export const connectNodes = (
  existingEdges: GraphEdge[],
  edge: Parameters<typeof normalizeGraphEdge>[0],
): ConnectNodesResult => {
  const normalized = normalizeGraphEdge(edge);
  if (!normalized.sourceNodeId || !normalized.targetNodeId) {
    return { ok: false, reason: "Edge requires source and target node ids." };
  }
  if (normalized.sourceNodeId === normalized.targetNodeId) {
    return { ok: false, reason: "Self-loop edges are not allowed." };
  }
  const nextEdges = [...existingEdges.map(normalizeGraphEdge), normalized];
  const validation = validateAcyclic(nextEdges);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "Connecting these nodes would create a cycle.",
      cyclePath: validation.cyclePath,
    };
  }
  return { ok: true, edges: nextEdges };
};
