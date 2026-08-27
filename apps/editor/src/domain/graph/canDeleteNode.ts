import type { NodeBase } from "./types";
import type { NodeReference } from "./references";

export interface NodeReferenceLocation {
  referenceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  referenceType: NodeReference["referenceType"];
  clipIds: string[];
}

export interface CanDeleteNodeResult {
  allowed: boolean;
  references: NodeReferenceLocation[];
  reason?: string;
}

/**
 * Returns whether a node may be deleted. Shared/instance references from other
 * nodes or clips block deletion (PRD §4.3 — no cascade delete).
 */
export const canDeleteNode = (
  nodeId: string,
  nodes: Record<string, NodeBase>,
  references: Record<string, NodeReference>,
  clipsByNodeId: Record<string, string[]>,
  options?: { ignoreClipId?: string },
): CanDeleteNodeResult => {
  if (!nodes[nodeId]) {
    return { allowed: false, references: [], reason: "Node not found." };
  }

  const locations: NodeReferenceLocation[] = [];
  for (const reference of Object.values(references)) {
    const involves =
      reference.sourceNodeId === nodeId || reference.targetNodeId === nodeId;
    if (!involves) {
      continue;
    }
    const clipIds = [
      ...(clipsByNodeId[reference.sourceNodeId] ?? []),
      ...(clipsByNodeId[reference.targetNodeId] ?? []),
    ].filter((id, index, arr) => arr.indexOf(id) === index);

    const filteredClips = options?.ignoreClipId
      ? clipIds.filter((id) => id !== options.ignoreClipId)
      : clipIds;

    // External reference: another node points at this one, or shared across clips
    const isExternalPointer = reference.targetNodeId === nodeId && reference.sourceNodeId !== nodeId;
    const isSharedAcrossClips =
      nodes[nodeId].referenceType === "shared" ||
      reference.referenceType === "shared" ||
      filteredClips.length > 0;

    if (isExternalPointer || (nodes[nodeId].referenceType !== "local" && isSharedAcrossClips)) {
      locations.push({
        referenceId: reference.id,
        sourceNodeId: reference.sourceNodeId,
        targetNodeId: reference.targetNodeId,
        referenceType: reference.referenceType,
        clipIds: filteredClips,
      });
    }
  }

  // Also block if other clips still list this node in their graphs
  const otherClips = (clipsByNodeId[nodeId] ?? []).filter((id) => id !== options?.ignoreClipId);
  if (otherClips.length > 0 && nodes[nodeId].referenceType !== "local") {
    if (!locations.some((loc) => loc.targetNodeId === nodeId || loc.sourceNodeId === nodeId)) {
      locations.push({
        referenceId: `usage-${nodeId}`,
        sourceNodeId: nodeId,
        targetNodeId: nodeId,
        referenceType: nodes[nodeId].referenceType,
        clipIds: otherClips,
      });
    }
  }

  if (locations.length > 0) {
    return {
      allowed: false,
      references: locations,
      reason: "Node is still referenced elsewhere.",
    };
  }

  return { allowed: true, references: [] };
};

/**
 * Which clip-graph node ids are safe to remove when deleting a clip.
 * Keeps shared/project/sequence nodes and nodes used by other clips.
 */
export const nodesRemovableWithClip = (
  clipNodeIds: string[],
  nodes: Record<string, NodeBase>,
  clipsByNodeId: Record<string, string[]>,
  clipId: string,
): string[] =>
  clipNodeIds.filter((nodeId) => {
    const node = nodes[nodeId];
    if (!node) {
      return false;
    }
    if (node.scope !== "clip") {
      return false;
    }
    if (node.referenceType === "shared") {
      return false;
    }
    const otherClips = (clipsByNodeId[nodeId] ?? []).filter((id) => id !== clipId);
    if (otherClips.length > 0) {
      return false;
    }
    return true;
  });
