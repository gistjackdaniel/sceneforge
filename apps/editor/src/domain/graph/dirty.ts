import type { GraphEdge, NodeBase, NodeStatus } from "./types";
import { edgeSourceId, edgeTargetId } from "./types";
import type { DependencyMap } from "../project/clipGraph";
import type { ClipGraph } from "../project/clipGraph";

export type DirtyReason =
  | "params_changed"
  | "input_changed"
  | "asset_version_changed"
  | "implementation_changed"
  | "manual_invalidate";

export interface DirtyEvent {
  sourceNodeId: string;
  reason: DirtyReason;
  timestamp: string;
}

export interface DirtyPropagationResult {
  dirtyNodeIds: string[];
  affectedClipIds: string[];
  renderNodeIds: string[];
}

const RENDER_KINDS = new Set(["StageRenderPassNode", "GenerativeRefinementNode", "RenderSettingsNode"]);

export const collectAllEdges = (clipGraphs: Record<string, ClipGraph>): GraphEdge[] =>
  Object.values(clipGraphs).flatMap((graph) => graph.edges ?? []);

export const buildDownstreamIndex = (
  edges: GraphEdge[],
  downstreamByNodeId: Record<string, string[]>,
): Record<string, string[]> => {
  const index: Record<string, string[]> = {};
  const add = (from: string, to: string) => {
    if (!from || !to || from === to) {
      return;
    }
    const list = index[from] ?? [];
    if (!list.includes(to)) {
      list.push(to);
    }
    index[from] = list;
  };

  Object.entries(downstreamByNodeId).forEach(([from, tos]) => {
    tos.forEach((to) => add(from, to));
  });
  edges.forEach((edge) => add(edgeSourceId(edge), edgeTargetId(edge)));
  return index;
};

export const buildUpstreamIndex = (downstream: Record<string, string[]>): Record<string, string[]> => {
  const upstream: Record<string, string[]> = {};
  Object.entries(downstream).forEach(([from, tos]) => {
    tos.forEach((to) => {
      const list = upstream[to] ?? [];
      if (!list.includes(from)) {
        list.push(from);
      }
      upstream[to] = list;
    });
  });
  return upstream;
};

/** BFS including the source node. */
export const collectDownstream = (
  nodeId: string,
  downstreamByNodeId: Record<string, string[]>,
): string[] => {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    ordered.push(current);
    (downstreamByNodeId[current] ?? []).forEach((next) => {
      if (!seen.has(next)) {
        queue.push(next);
      }
    });
  }
  return ordered;
};

/**
 * Mark the source node and all downstream dependents dirty.
 * Unconnected clips are not included in affectedClipIds.
 */
export const markDirty = (
  event: DirtyEvent,
  nodes: Record<string, NodeBase>,
  dependencyMap: DependencyMap,
  edges: GraphEdge[] = [],
): DirtyPropagationResult => {
  const downstreamIndex = buildDownstreamIndex(edges, dependencyMap.downstreamByNodeId);
  const dirtyNodeIds = collectDownstream(event.sourceNodeId, downstreamIndex).filter(
    (id) => nodes[id] !== undefined,
  );

  const affected = new Set<string>();
  dirtyNodeIds.forEach((nodeId) => {
    (dependencyMap.clipsByNodeId[nodeId] ?? []).forEach((clipId) => affected.add(clipId));
  });

  const renderNodeIds = dirtyNodeIds.filter((id) => RENDER_KINDS.has(nodes[id]?.kind ?? ""));

  return {
    dirtyNodeIds,
    affectedClipIds: Array.from(affected),
    renderNodeIds,
  };
};

export const applyDirtyStatuses = (
  nodes: Record<string, NodeBase>,
  dirtyNodeIds: string[],
  timestamp: string,
): Record<string, NodeBase> => {
  const dirty = new Set(dirtyNodeIds);
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => {
      if (!dirty.has(id)) {
        return [id, node];
      }
      const nextStatus: NodeStatus = node.status === "disabled" ? "disabled" : "dirty";
      return [id, { ...node, status: nextStatus, updatedAt: timestamp }];
    }),
  );
};
