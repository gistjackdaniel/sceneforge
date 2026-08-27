import type { NodeReference } from "./references";
import type { GraphEdge, NodeBase } from "./types";
import { validateAcyclic, type AcyclicValidationResult } from "./validateAcyclic";
import { collectReferencedNodeIds } from "./references";
import type { ClipGraph, DependencyMap } from "../project/clipGraph";
import {
  applyDirtyStatuses,
  buildDownstreamIndex,
  buildUpstreamIndex,
  collectAllEdges,
  collectDownstream,
  markDirty,
  type DirtyEvent,
  type DirtyPropagationResult,
} from "./dirty";
import { canDeleteNode, type NodeReferenceLocation } from "./canDeleteNode";

export interface DependencyServiceSnapshot {
  nodes: Record<string, NodeBase>;
  references: Record<string, NodeReference>;
  clipGraphs: Record<string, ClipGraph>;
  dependencyMap: DependencyMap;
}

export interface DependencyService {
  getUpstream(nodeId: string): string[];
  getDownstream(nodeId: string): string[];
  getDirectReferences(nodeId: string): NodeReference[];
  revealReferences(nodeId: string): NodeReferenceLocation[];
  markDirty(event: DirtyEvent): DirtyPropagationResult;
  validateAcyclic(graphId: string): AcyclicValidationResult;
}

const edgesForGraph = (snapshot: DependencyServiceSnapshot, graphId?: string): GraphEdge[] => {
  if (graphId) {
    return snapshot.clipGraphs[graphId]?.edges ?? [];
  }
  return collectAllEdges(snapshot.clipGraphs);
};

/**
 * DependencyService wrapping existing usage/reference indexes (PRD §8.3).
 */
export const createDependencyService = (snapshot: DependencyServiceSnapshot): DependencyService => {
  const edges = collectAllEdges(snapshot.clipGraphs);
  const downstreamIndex = buildDownstreamIndex(edges, snapshot.dependencyMap.downstreamByNodeId);
  const upstreamIndex = buildUpstreamIndex(downstreamIndex);

  return {
    getUpstream(nodeId: string): string[] {
      return [...(upstreamIndex[nodeId] ?? [])];
    },
    getDownstream(nodeId: string): string[] {
      return collectDownstream(nodeId, downstreamIndex).filter((id) => id !== nodeId);
    },
    getDirectReferences(nodeId: string): NodeReference[] {
      return Object.values(snapshot.references).filter(
        (reference) => reference.sourceNodeId === nodeId || reference.targetNodeId === nodeId,
      );
    },
    revealReferences(nodeId: string): NodeReferenceLocation[] {
      const related = collectReferencedNodeIds(
        nodeId,
        snapshot.references,
        snapshot.dependencyMap.referencesByNodeId,
      );
      const lookup = canDeleteNode(
        nodeId,
        snapshot.nodes,
        snapshot.references,
        snapshot.dependencyMap.clipsByNodeId,
      );
      const fromDelete = lookup.references;
      if (fromDelete.length > 0) {
        return fromDelete;
      }
      return related
        .filter((id) => id !== nodeId)
        .map((id) => ({
          referenceId: `related-${id}`,
          sourceNodeId: nodeId,
          targetNodeId: id,
          referenceType: snapshot.nodes[id]?.referenceType ?? "local",
          clipIds: snapshot.dependencyMap.clipsByNodeId[id] ?? [],
        }));
    },
    markDirty(event: DirtyEvent): DirtyPropagationResult {
      return markDirty(event, snapshot.nodes, snapshot.dependencyMap, edges);
    },
    validateAcyclic(graphId: string): AcyclicValidationResult {
      return validateAcyclic(edgesForGraph(snapshot, graphId));
    },
  };
};

export const applyDirtyEventToNodes = (
  snapshot: DependencyServiceSnapshot,
  event: DirtyEvent,
): { nodes: Record<string, NodeBase>; result: DirtyPropagationResult } => {
  const service = createDependencyService(snapshot);
  const result = service.markDirty(event);
  return {
    nodes: applyDirtyStatuses(snapshot.nodes, result.dirtyNodeIds, event.timestamp),
    result,
  };
};
