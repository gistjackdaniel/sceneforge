import { computeClipCacheDependencyHash } from "../dependency/cacheDependency";
import { indexSharedNodeClipUsage } from "../dependency/usageIndex";
import type { DependencyMap } from "./types";
import type { NodeBase } from "../nodes/types";
import type { TimelineClip } from "../project/types";
import type { NodeReference } from "../references/types";
import type { ClipGraph } from "./types";

export const buildDependencyMap = (
  nodes: Record<string, NodeBase>,
  clips: Record<string, TimelineClip>,
  references: Record<string, NodeReference>,
  clipGraphs: Record<string, ClipGraph>,
): DependencyMap => {
  const downstreamByNodeId: Record<string, string[]> = {};
  const clipsByNodeId: Record<string, string[]> = {};
  const referencesByNodeId: Record<string, string[]> = {};

  Object.values(nodes).forEach((node) => {
    downstreamByNodeId[node.id] = [...node.downstreamNodeIds];
  });

  Object.values(clipGraphs).forEach((graph) => {
    graph.nodeIds.forEach((nodeId) => {
      if (!clipsByNodeId[nodeId]) {
        clipsByNodeId[nodeId] = [];
      }
      if (!clipsByNodeId[nodeId].includes(graph.clipId)) {
        clipsByNodeId[nodeId].push(graph.clipId);
      }
    });
  });

  Object.values(references).forEach((reference) => {
    if (!referencesByNodeId[reference.sourceNodeId]) {
      referencesByNodeId[reference.sourceNodeId] = [];
    }
    if (!referencesByNodeId[reference.targetNodeId]) {
      referencesByNodeId[reference.targetNodeId] = [];
    }
    referencesByNodeId[reference.sourceNodeId].push(reference.id);
    referencesByNodeId[reference.targetNodeId].push(reference.id);
  });

  const indexedClipsByNodeId = indexSharedNodeClipUsage(references, clipGraphs, clipsByNodeId);

  const cacheHashesByClipId: Record<string, string> = {};
  Object.values(clips).forEach((clip) => {
    cacheHashesByClipId[clip.id] = computeClipCacheDependencyHash(clip.id, clipGraphs, nodes);
  });

  return {
    downstreamByNodeId,
    clipsByNodeId: indexedClipsByNodeId,
    referencesByNodeId,
    cacheHashesByClipId,
  };
};

export const buildClipNodeIndex = (clips: Record<string, TimelineClip>) =>
  Object.values(clips).reduce<Record<string, string[]>>((accumulator, clip) => {
    accumulator[clip.id] = [];
    return accumulator;
  }, {});
