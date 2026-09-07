import type { NodeReference, NodeScope } from "./references";
import type { WorldMode } from "../worlds/types";

export type NodeCategory =
  | "source"
  | "scene"
  | "cinematic"
  | "performance"
  | "look"
  | "render"
  | "capture"
  | "library";

export type NodeStatus = "clean" | "dirty" | "running" | "failed" | "disabled";

export type EdgeKind = "data" | "reference" | "dependency" | "control" | "temporal";

/**
 * Canonical node kinds (PRD §7). Legacy names are normalized in migrate.
 * Deprecated: SpatialMemoryNode, GeneratedSegmentNode, MemoryRetrieveNode,
 * CorrespondenceNode, WorldAssetNode — preserved for persisted data only.
 */
export type NodeKind =
  | "ImageSourceNode"
  | "TextSourceNode"
  | "CameraPathNode"
  | "ImageToWorldNode"
  | "GeneratedSegmentNode"
  | "SpatialMemoryNode"
  /** @deprecated connector-internal; do not create new nodes */
  | "MemoryRetrieveNode"
  /** @deprecated connector-internal; do not create new nodes */
  | "CorrespondenceNode"
  | "VideoPlateNode"
  | "WorldReferenceNode"
  /** @deprecated prefer WorldAsset + WorldReferenceNode */
  | "WorldAssetNode"
  | "WorldElementRefNode"
  | "PlacementNode"
  | "ActorPlacementNode"
  | "CameraRigNode"
  | "LensNode"
  | "LightingRigNode"
  | "ShotPresetNode"
  | "PerformancePlanNode"
  | "ActionBlockNode"
  | "KeyframeNode"
  | "ColorGradeNode"
  | "MaterialOverrideNode"
  | "GenerativeRefinementNode"
  | "StageRenderPassNode"
  | "RenderSettingsNode"
  | "TimelineClipNode"
  | "CaptureClipNode"
  | "ObjectTrajectoryNode"
  | "VideoGenerationNode";

export interface PortDefinition {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  multiple: boolean;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
  kind: EdgeKind;
  /** Legacy display label */
  label?: string;
}

/** @deprecated Use GraphEdge; kept for gradual call-site migration */
export type NodeEdge = GraphEdge & {
  /** @deprecated use sourceNodeId */
  source?: string;
  /** @deprecated use targetNodeId */
  target?: string;
};

export interface NodeUiState {
  position?: { x: number; y: number };
}

export interface GraphNode<TParams = Record<string, unknown>> {
  id: string;
  /** PRD field; mirrors `kind` for NodeKind-typed catalogue nodes */
  type: string;
  version: number;
  scope: NodeScope;
  name: string;
  params?: TParams;
  inputPorts: PortDefinition[];
  outputPorts: PortDefinition[];
  status: NodeStatus;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
  /** Presentation-only; excluded from content hash / cache key (PRD §11.2) */
  ui?: NodeUiState;
}

export interface NodeBase extends GraphNode<Record<string, unknown>> {
  kind: NodeKind;
  category: NodeCategory;
  enabled: boolean;
  tags: string[];
  referenceType: NodeReference["referenceType"];
  /** Store uses `parameters`; mirrors GraphNode.params */
  parameters: Record<string, unknown>;
  downstreamNodeIds: string[];
}

export interface TimelineClipNode extends NodeBase {
  kind: "TimelineClipNode";
  parameters: {
    clipId: string;
    worldMode?: WorldMode;
    linkedWorldId?: string;
  };
}

const LEGACY_KIND_MAP: Record<string, NodeKind> = {
  CameraTrajectoryNode: "CameraPathNode",
  WorldGenerateNode: "ImageToWorldNode",
  PromptNode: "TextSourceNode",
  PropPlacementNode: "PlacementNode",
  WorldRefNode: "WorldReferenceNode",
};

export const normalizeNodeKind = (value: string): NodeKind => {
  if (value in LEGACY_KIND_MAP) {
    return LEGACY_KIND_MAP[value];
  }
  return value as NodeKind;
};

/** Kinds that must not be newly created (connector-internal / deprecated). */
export const DEPRECATED_NODE_KINDS: ReadonlySet<NodeKind> = new Set([
  "MemoryRetrieveNode",
  "CorrespondenceNode",
  "WorldAssetNode",
  "GeneratedSegmentNode",
  "SpatialMemoryNode",
]);

export const edgeSourceId = (edge: GraphEdge | NodeEdge): string =>
  edge.sourceNodeId ?? (edge as NodeEdge).source ?? "";

export const edgeTargetId = (edge: GraphEdge | NodeEdge): string =>
  edge.targetNodeId ?? (edge as NodeEdge).target ?? "";

export const normalizeGraphEdge = (edge: Partial<GraphEdge> & { id: string } & {
  source?: string;
  target?: string;
  label?: string;
}): GraphEdge => ({
  id: edge.id,
  sourceNodeId: edge.sourceNodeId ?? edge.source ?? "",
  sourcePort: edge.sourcePort ?? "out",
  targetNodeId: edge.targetNodeId ?? edge.target ?? "",
  targetPort: edge.targetPort ?? "in",
  kind: edge.kind ?? "data",
  label: edge.label,
});

export const defaultPorts = (): { inputPorts: PortDefinition[]; outputPorts: PortDefinition[] } => ({
  inputPorts: [{ id: "in", name: "in", dataType: "any", required: false, multiple: true }],
  outputPorts: [{ id: "out", name: "out", dataType: "any", required: false, multiple: true }],
});
