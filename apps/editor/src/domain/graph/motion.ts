/**
 * Camera motion vs object motion must not share a node (PRD §9.5).
 */
export const CAMERA_MOTION_KINDS = ["CameraRigNode", "CameraPathNode", "LensNode"] as const;
export const OBJECT_MOTION_KINDS = ["ObjectTrajectoryNode", "ActionBlockNode"] as const;

export type CameraMotionKind = (typeof CAMERA_MOTION_KINDS)[number];
export type ObjectMotionKind = (typeof OBJECT_MOTION_KINDS)[number];

export interface ObjectTrajectoryKeyframe {
  frame: number;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface ObjectTrajectoryParams {
  targetNodeId?: string;
  keyframes: ObjectTrajectoryKeyframe[];
}

export interface ActionBlockParams {
  label: string;
  startFrame: number;
  endFrame: number;
  actorNodeId?: string;
}

export const isCameraMotionKind = (kind: string): kind is CameraMotionKind =>
  (CAMERA_MOTION_KINDS as readonly string[]).includes(kind);

export const isObjectMotionKind = (kind: string): kind is ObjectMotionKind =>
  (OBJECT_MOTION_KINDS as readonly string[]).includes(kind);
