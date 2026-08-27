import type { AssetRecord } from "../assets/types";
import type { NodeBase } from "../graph/types";
import type { NodeReference } from "../graph/references";
import type { RenderCacheEntry } from "../rendering/types";
import type { Sequence, TimelineClip } from "../timeline/types";
import type { WorldAsset } from "../worlds/types";
import type { ModelExecutionRecord } from "../worlds/modelExecution";
import type { ClipGraph, DependencyMap } from "./clipGraph";

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
  /** PRD §3 Asset registry */
  assets: Record<string, AssetRecord>;
  caches: Record<string, RenderCacheEntry>;
  connectors: Record<string, ExternalConnector>;
  libraryNodeIds: string[];
  modelExecutions?: Record<string, ModelExecutionRecord>;
}
