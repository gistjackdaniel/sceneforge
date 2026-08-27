import type { GraphEdge, NodeBase } from "../graph/types";
import type { RenderCacheEntry } from "../rendering/types";

export interface ClipGraph {
  id: string;
  clipId: string;
  rootNodeId: string;
  nodeIds: string[];
  edges: GraphEdge[];
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
  cacheHashesByClipId: Record<string, string>;
}

export interface ClipGraphBundle {
  graph: ClipGraph;
  nodes: NodeBase[];
  caches: RenderCacheEntry[];
}
