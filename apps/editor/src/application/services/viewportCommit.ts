import type { NodeKind } from "../../domain/graph/types";
import type { CameraInterpolation, CameraKeyframe, CameraPathParams } from "../../domain/graph/cameraPath";
import { cameraPathParamsFromNode, upsertCameraKeyframe } from "../../domain/graph/cameraPath";

export {
  eulerToQuaternionXYZ as eulerToQuaternionApprox,
  quaternionToEulerXYZ as quaternionToEulerApprox,
} from "../../domain/graph/cameraRotation";
import { isCameraMotionKind, isObjectMotionKind } from "../../domain/graph/motion";
import type { WorldElement } from "../../domain/worlds/types";
import type { TimelineClip } from "../../domain/timeline/types";
import type { NodeBase } from "../../domain/graph/types";

export type ViewportObjectKind = "actor" | "prop" | "light" | "camera";

export const placementNodeIdForElement = (clipId: string, worldElementId: string): string =>
  `node-${clipId}-placement-${worldElementId}`;

export const cameraPathNodeIdForClip = (clip: Pick<TimelineClip, "id" | "cameraPathNodeId" | "cameraTrajectoryNodeId">): string =>
  clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;

export const nodeKindForObject = (
  kind: ViewportObjectKind,
  elementKind?: WorldElement["kind"],
): NodeKind => {
  if (kind === "camera") {
    return "CameraPathNode";
  }
  if (kind === "actor" || elementKind === "actor_mark") {
    return "ActorPlacementNode";
  }
  if (kind === "light" || elementKind === "light_socket") {
    return "LightingRigNode";
  }
  return "PlacementNode";
};

export const assertMotionSeparation = (nodeKind: string, objectKind: ViewportObjectKind): void => {
  if (objectKind === "camera" && isObjectMotionKind(nodeKind)) {
    throw new Error("Camera motion cannot be stored on an object motion node.");
  }
  if (objectKind !== "camera" && isCameraMotionKind(nodeKind)) {
    throw new Error("Object motion cannot be stored on a camera motion node.");
  }
};

export interface ObjectTransformCommit {
  worldElementId: string;
  kind: Exclude<ViewportObjectKind, "camera">;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: [number, number, number];
  layer: "clip";
}

export const buildPlacementParams = (commit: ObjectTransformCommit): Record<string, unknown> => ({
  worldElementId: commit.worldElementId,
  mark: commit.kind === "actor" ? commit.worldElementId : undefined,
  prop: commit.kind === "prop" ? commit.worldElementId : undefined,
  lightId: commit.kind === "light" ? commit.worldElementId : undefined,
  position: { x: commit.position[0], y: commit.position[1], z: commit.position[2] },
  rotation: { x: commit.rotation[0], y: commit.rotation[1], z: commit.rotation[2] },
  scale: commit.scale
    ? { x: commit.scale[0], y: commit.scale[1], z: commit.scale[2] }
    : undefined,
  layer: commit.layer,
});

export const readPlacementTransform = (
  node: NodeBase | undefined,
): { position: [number, number, number]; rotation: [number, number, number] } | undefined => {
  if (!node) {
    return undefined;
  }
  const position = node.parameters.position;
  const rotation = node.parameters.rotation;
  if (!position || typeof position !== "object" || !rotation || typeof rotation !== "object") {
    return undefined;
  }
  const pos = position as { x?: number; y?: number; z?: number };
  const rot = rotation as { x?: number; y?: number; z?: number };
  return {
    position: [pos.x ?? 0, pos.y ?? 0, pos.z ?? 0],
    rotation: [rot.x ?? 0, rot.y ?? 0, rot.z ?? 0],
  };
};

export const buildCameraKeyframePatch = (
  existing: Record<string, unknown>,
  keyframe: CameraKeyframe,
  interpolation?: CameraInterpolation,
): CameraPathParams => {
  const current = cameraPathParamsFromNode(existing);
  const next = upsertCameraKeyframe(current, keyframe);
  return interpolation ? { ...next, interpolation } : next;
};

