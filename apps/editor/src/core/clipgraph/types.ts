import type { RenderCacheEntry } from "../cache/types";
import type { NodeBase, NodeEdge } from "../nodes/types";

export interface ClipGraph {
  id: string;
  clipId: string;
  rootNodeId: string;
  nodeIds: string[];
  edges: NodeEdge[];
  previewFrames: string[];
  finalFrames: string[];
  renderedVideoCacheId?: string;
  keyframeNodeIds: string[];
  proxyCacheId?: string;
}

export interface DependencyMap {
  downstreamByNodeId: Record<string, string[]>;
  clipsByNodeId: Record<string, string[]>;
  referencesByNodeId: Record<string, string[]>;
}

export interface ClipGraphBundle {
  graph: ClipGraph;
  nodes: NodeBase[];
  caches: RenderCacheEntry[];
}
