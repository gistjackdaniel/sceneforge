import type { DependencyMap } from "./types";
import type { NodeBase } from "../nodes/types";
import type { TimelineClip } from "../project/types";
import type { NodeReference } from "../references/types";

export const buildDependencyMap = (
  nodes: Record<string, NodeBase>,
  clipNodeIdsByClipId: Record<string, string[]>,
  references: Record<string, NodeReference>,
): DependencyMap => {
  const downstreamByNodeId: Record<string, string[]> = {};
  const clipsByNodeId: Record<string, string[]> = {};
  const referencesByNodeId: Record<string, string[]> = {};

  Object.values(nodes).forEach((node) => {
    downstreamByNodeId[node.id] = [...node.downstreamNodeIds];
  });

  Object.entries(clipNodeIdsByClipId).forEach(([clipId, nodeIds]) => {
    nodeIds.forEach((nodeId) => {
      if (!clipsByNodeId[nodeId]) {
        clipsByNodeId[nodeId] = [];
      }
      clipsByNodeId[nodeId].push(clipId);
    });
  });

  Object.values(references).forEach((reference) => {
    referencesByNodeId[reference.sourceNodeId] = [
      ...(referencesByNodeId[reference.sourceNodeId] ?? []),
      reference.id,
    ];
    referencesByNodeId[reference.targetNodeId] = [
      ...(referencesByNodeId[reference.targetNodeId] ?? []),
      reference.id,
    ];
  });

  return { downstreamByNodeId, clipsByNodeId, referencesByNodeId };
};

export const buildClipNodeIndex = (clips: Record<string, TimelineClip>) =>
  Object.values(clips).reduce<Record<string, string[]>>((accumulator, clip) => {
    accumulator[clip.id] = [];
    return accumulator;
  }, {});
