import {
  canDeleteNode,
  nodesRemovableWithClip,
  type CanDeleteNodeResult,
} from "../../domain/graph/canDeleteNode";
import { connectNodes, type ConnectNodesResult } from "../../domain/graph/connectNodes";
import type { GraphEdge, NodeBase } from "../../domain/graph/types";
import type { NodeReference } from "../../domain/graph/references";
import type { Project } from "../../domain/project/types";

export const attemptConnectNodes = (
  edges: GraphEdge[],
  edge: Parameters<typeof connectNodes>[1],
): ConnectNodesResult => connectNodes(edges, edge);

export const attemptDeleteNode = (
  project: Project,
  nodeId: string,
  options?: { ignoreClipId?: string },
): CanDeleteNodeResult =>
  canDeleteNode(
    nodeId,
    project.nodes,
    project.references,
    project.dependencyMap.clipsByNodeId,
    options,
  );

export const resolveNodesToRemoveWithClip = (
  project: Project,
  clipId: string,
  clipNodeIds: string[],
): string[] =>
  nodesRemovableWithClip(
    clipNodeIds,
    project.nodes,
    project.dependencyMap.clipsByNodeId,
    clipId,
  );

export type { CanDeleteNodeResult, ConnectNodesResult, GraphEdge, NodeBase, NodeReference };
