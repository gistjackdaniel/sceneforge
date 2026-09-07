import type { NodeKind } from "../../domain/graph/types";
import type { CacheKind } from "../../domain/rendering/types";
import {
  fullDirectionInvalidation,
  type DirectionChannelInvalidation,
} from "../../domain/direction";

/** Spec-aligned invalidation targets per node kind (PRD §11.6). */
export const INVALIDATION_TARGETS_BY_KIND: Partial<Record<NodeKind, CacheKind[]>> = {
  WorldAssetNode: ["proxy", "final", "stage_render_pass", "world_reconstruction"],
  WorldReferenceNode: ["proxy", "final", "stage_render_pass", "world_reconstruction"],
  SpatialMemoryNode: ["spatial_memory", "node_evaluation"],
  CameraPathNode: ["generated_segment", "stage_render_pass", "proxy", "final"],
  CameraRigNode: ["node_evaluation", "stage_render_pass", "proxy", "final"],
  LensNode: ["node_evaluation", "stage_render_pass", "proxy", "final"],
  LightingRigNode: ["proxy", "final"],
  GenerativeRefinementNode: ["final"],
  StageRenderPassNode: ["stage_render_pass", "proxy"],
  ImageToWorldNode: ["world_reconstruction", "generated_segment", "spatial_memory"],
  ActorPlacementNode: ["node_evaluation", "stage_render_pass", "proxy", "final"],
  PlacementNode: ["node_evaluation", "stage_render_pass", "proxy", "final"],
  ObjectTrajectoryNode: ["proxy", "final"],
  ActionBlockNode: ["proxy", "final"],
  KeyframeNode: ["stage_render_pass", "proxy"],
};

export const getInvalidationTargets = (nodeKind: NodeKind): CacheKind[] =>
  INVALIDATION_TARGETS_BY_KIND[nodeKind] ?? ["proxy", "final"];

const full = (...channels: DirectionChannelInvalidation["channel"][]): DirectionChannelInvalidation[] =>
  channels.map((channel) => ({ channel }));

/** Direction lanes affected by a node recipe change. */
export const getDirectionInvalidations = (nodeKind: NodeKind): DirectionChannelInvalidation[] => {
  switch (nodeKind) {
    case "CameraPathNode":
    case "CameraRigNode":
    case "LensNode":
      return full("camera");
    case "WorldAssetNode":
    case "WorldReferenceNode":
    case "LightingRigNode":
    case "ActorPlacementNode":
    case "PlacementNode":
    case "ImageToWorldNode":
      return full("structure");
    case "ObjectTrajectoryNode":
    case "ActionBlockNode":
      return full("performance_body");
    case "PerformancePlanNode":
      return full("performance_body", "performance_face", "audio");
    case "KeyframeNode":
      return full("camera", "structure");
    default:
      return fullDirectionInvalidation();
  }
};
