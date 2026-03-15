import type { NodeReference, NodeScope } from "../references/types";
import type { WorldMode } from "../world/types";

export type NodeCategory =
  | "source"
  | "scene"
  | "cinematic"
  | "look"
  | "render"
  | "capture"
  | "library";

export type NodeKind =
  | "ImageSourceNode"
  | "VideoPlateNode"
  | "WorldRefNode"
  | "WorldElementRefNode"
  | "PlacementNode"
  | "ActorPlacementNode"
  | "CameraRigNode"
  | "LensNode"
  | "LightingRigNode"
  | "ShotPresetNode"
  | "CameraPathNode"
  | "ActionBlockNode"
  | "KeyframeNode"
  | "ColorGradeNode"
  | "MaterialOverrideNode"
  | "RenderSettingsNode"
  | "TimelineClipNode"
  | "CaptureClipNode";

export interface NodeEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface NodeBase {
  id: string;
  name: string;
  kind: NodeKind;
  category: NodeCategory;
  scope: NodeScope;
  enabled: boolean;
  tags: string[];
  version: number;
  referenceType: NodeReference["referenceType"];
  parameters: Record<string, unknown>;
  downstreamNodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TimelineClipNode extends NodeBase {
  kind: "TimelineClipNode";
  parameters: {
    clipId: string;
    worldMode?: WorldMode;
    linkedWorldId?: string;
  };
}
