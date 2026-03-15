import type { RenderCacheEntry } from "../cache/types";
import type { ClipGraph, DependencyMap } from "../clipgraph/types";
import type { NodeBase } from "../nodes/types";
import type { NodeReference } from "../references/types";
import type { WorldAsset, WorldMode } from "../world/types";

export type ClipSourceType = "empty" | "video" | "generated";

export interface TimelineClip {
  id: string;
  name: string;
  start: number;
  end: number;
  duration: number;
  sourceType: ClipSourceType;
  linkedWorldId?: string;
  clipGraphId: string;
  worldMode?: WorldMode;
  variant?: string;
  proxyCacheId?: string;
  finalCacheId?: string;
  audioTrackId?: string;
}

export interface Sequence {
  id: string;
  name: string;
  clipIds: string[];
  playhead: number;
  visibleRange: [number, number];
}

export interface ExternalConnector {
  id: string;
  name: string;
  description: string;
  outputKinds: string[];
  lastRunAt?: string;
}

export interface PerformanceMetrics {
  editLatencyMs: number;
  regenerationCount: number;
  nodeReuseRate: number;
  cacheHitRate: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  metrics: PerformanceMetrics;
  activeSequenceId: string;
  sequences: Record<string, Sequence>;
  clips: Record<string, TimelineClip>;
  clipGraphs: Record<string, ClipGraph>;
  nodes: Record<string, NodeBase>;
  references: Record<string, NodeReference>;
  dependencyMap: DependencyMap;
  worlds: Record<string, WorldAsset>;
  caches: Record<string, RenderCacheEntry>;
  connectors: Record<string, ExternalConnector>;
  libraryNodeIds: string[];
}
