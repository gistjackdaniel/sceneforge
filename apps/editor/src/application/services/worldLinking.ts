import type { NodeBase } from "../../domain/graph/types";
import type { Project } from "../../domain/project/types";
import { applyDirtyEventToNodes } from "../../domain/graph/dependencyService";
import { computeNodeContentHash } from "../../domain/graph/cacheKey";
import { createNodeBase } from "./nodeFactory";

export const worldReferenceNodeIdForClip = (clipId: string): string => `node-${clipId}-worldref`;

export const findWorldReferenceNodesInClip = (project: Project, clipId: string): NodeBase[] => {
  const clip = project.clips[clipId];
  if (!clip) {
    return [];
  }
  const graph = project.clipGraphs[clip.clipGraphId];
  if (!graph) {
    return [];
  }
  return graph.nodeIds
    .map((id) => project.nodes[id])
    .filter((node): node is NodeBase => node?.kind === "WorldReferenceNode");
};

export const findWorldReferenceNode = (
  project: Project,
  clipId: string,
  worldId: string,
): NodeBase | undefined =>
  findWorldReferenceNodesInClip(project, clipId).find((node) => node.parameters.worldId === worldId);

export interface LinkWorldToClipResult {
  project: Project;
  nodeId: string;
  created: boolean;
  alreadyLinked: boolean;
  reason?: string;
}

const makeWorldRefEdge = (id: string, sourceNodeId: string, targetNodeId: string) => ({
  id,
  sourceNodeId,
  sourcePort: "out",
  targetNodeId,
  targetPort: "in",
  kind: "data" as const,
  label: "references",
});

/**
 * Attach a WorldAsset to a clip via linkedWorldId + WorldReferenceNode.
 * Does not clone the world. Reuses an existing WorldReferenceNode for the clip.
 */
export const linkWorldToClip = (
  project: Project,
  input: { clipId: string; worldId: string; timestamp: string },
): LinkWorldToClipResult => {
  const clip = project.clips[input.clipId];
  if (!clip) {
    return {
      project,
      nodeId: "",
      created: false,
      alreadyLinked: false,
      reason: "현재 선택된 클립이 없습니다.",
    };
  }
  const world = project.worlds[input.worldId];
  if (!world) {
    return {
      project,
      nodeId: "",
      created: false,
      alreadyLinked: false,
      reason: "연결된 월드를 찾을 수 없습니다. 삭제되었거나 아직 생성되지 않았습니다.",
    };
  }
  const graph = project.clipGraphs[clip.clipGraphId];
  if (!graph) {
    return {
      project,
      nodeId: "",
      created: false,
      alreadyLinked: false,
      reason: "클립 그래프를 찾을 수 없습니다.",
    };
  }

  const existingForWorld = findWorldReferenceNode(project, clip.id, world.id);
  const existingAny = findWorldReferenceNodesInClip(project, clip.id)[0];
  const nodeId = existingForWorld?.id ?? existingAny?.id ?? worldReferenceNodeIdForClip(clip.id);
  const alreadyLinked = Boolean(existingForWorld) && clip.linkedWorldId === world.id;
  if (alreadyLinked && existingForWorld) {
    return { project, nodeId: existingForWorld.id, created: false, alreadyLinked: true };
  }

  const created = !project.nodes[nodeId];
  const worldRef = project.nodes[nodeId]
    ? {
        ...project.nodes[nodeId],
        parameters: {
          ...project.nodes[nodeId].parameters,
          worldId: world.id,
          worldMode: "referenced",
          proxyKind: world.proxyKind,
        },
        params: {
          ...project.nodes[nodeId].parameters,
          worldId: world.id,
          worldMode: "referenced",
          proxyKind: world.proxyKind,
        },
        updatedAt: input.timestamp,
      }
    : createNodeBase({
        id: nodeId,
        name: "World Reference",
        kind: "WorldReferenceNode",
        category: "scene",
        timestamp: input.timestamp,
        referenceType: "shared",
        parameters: {
          worldId: world.id,
          worldMode: "referenced",
          proxyKind: world.proxyKind,
        },
        downstreamNodeIds: [`node-${clip.id}-render`],
      });
  worldRef.contentHash = computeNodeContentHash(worldRef);

  const clipRootId = `node-${clip.id}-clip`;
  const clipRoot = project.nodes[clipRootId];
  const nodes: Project["nodes"] = {
    ...project.nodes,
    [nodeId]: worldRef,
  };
  if (clipRoot) {
    const nextParams = {
      ...clipRoot.parameters,
      linkedWorldId: world.id,
      worldMode: "referenced",
    };
    nodes[clipRootId] = {
      ...clipRoot,
      parameters: nextParams,
      params: nextParams,
      updatedAt: input.timestamp,
    };
  }

  const renderNodeId = `node-${clip.id}-render`;
  const nextNodeIds = graph.nodeIds.includes(nodeId) ? graph.nodeIds : [...graph.nodeIds, nodeId];
  const hasEdge = graph.edges.some(
    (edge) => edge.sourceNodeId === nodeId && edge.targetNodeId === renderNodeId,
  );
  const nextEdges = hasEdge
    ? graph.edges
    : [...graph.edges, makeWorldRefEdge(`edge-${clip.id}-worldref`, nodeId, renderNodeId)];

  const withGraph: Project = {
    ...project,
    clips: {
      ...project.clips,
      [clip.id]: {
        ...clip,
        linkedWorldId: world.id,
        worldMode: "referenced",
      },
    },
    nodes,
    clipGraphs: {
      ...project.clipGraphs,
      [graph.id]: {
        ...graph,
        nodeIds: nextNodeIds,
        edges: nextEdges,
      },
    },
  };

  const { nodes: dirtied } = applyDirtyEventToNodes(
    {
      nodes: withGraph.nodes,
      references: withGraph.references,
      clipGraphs: withGraph.clipGraphs,
      dependencyMap: withGraph.dependencyMap,
    },
    { sourceNodeId: nodeId, reason: "params_changed", timestamp: input.timestamp },
  );

  return {
    project: { ...withGraph, nodes: dirtied },
    nodeId,
    created,
    alreadyLinked: false,
  };
};
