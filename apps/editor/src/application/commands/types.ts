import type { NodeBase } from "../../domain/graph/types";
import type { NodeReference, ReferenceType } from "../../domain/graph/references";
import type { GraphEdge } from "../../domain/graph/types";
import type { CameraRigPreset } from "../../domain/graph/cameraRig";
import type { JointTarget } from "../../domain/performance/poseTrack";

/** PRD §13.1 — domain commands. UI-only actions are not commands. */
export type DomainCommand =
  | { type: "CREATE_NODE"; node: NodeBase; clipGraphId?: string }
  | { type: "DELETE_NODE"; nodeId: string }
  | {
      type: "UPDATE_NODE_PARAMS";
      nodeId: string;
      patch: Record<string, unknown>;
      previous?: Record<string, unknown>;
    }
  // SMPL-X pose commands. Same DomainCommand bus and undo stack as *_CAMERA_KEYFRAME.
  | {
      type: "ADD_POSE_KEYFRAME";
      nodeId: string;
      frame: number;
      pose: {
        global_orient: [number, number, number];
        transl: [number, number, number];
        body_pose: number[];
        left_hand_pose: number[];
        right_hand_pose: number[];
        jaw_pose: [number, number, number];
        expression: number[];
      };
    }
  | { type: "REMOVE_POSE_KEYFRAME"; nodeId: string; frame: number }
  | { type: "MOVE_POSE_KEYFRAME"; nodeId: string; from: number; to: number }
  | {
      type: "APPLY_POSE_PRESET";
      nodeId: string;
      frame: number;
      presetId: "t_pose" | "a_pose" | "idle" | "walk_contact" | "sit" | "point";
      hand?: { side: "left" | "right"; preset: "open" | "fist" | "point" | "relaxed" };
    }
  | {
      type: "SET_JOINT_ROTATION";
      nodeId: string;
      frame: number;
      target: JointTarget;
      axisAngle: [number, number, number];
    }
  | { type: "UPDATE_NODE_UI"; nodeId: string; ui: NonNullable<NodeBase["ui"]>; previous?: NodeBase["ui"] }
  | { type: "RENAME_NODE"; nodeId: string; name: string; previous?: string }
  | { type: "CONNECT_NODES"; clipGraphId: string; edge: GraphEdge }
  | { type: "DISCONNECT_NODES"; clipGraphId: string; edgeId: string; edge?: GraphEdge }
  | { type: "BREAK_LINK"; referenceId: string }
  | { type: "MAKE_LOCAL"; nodeId: string }
  | { type: "OVERRIDE_VALUE"; referenceId: string; patch: Record<string, unknown> }
  | { type: "SET_REFERENCE_TYPE"; referenceId: string; referenceType: ReferenceType; previous?: ReferenceType }
  | {
      type: "UPDATE_CLIP_TIMING";
      clipId: string;
      startFrame: number;
      durationFrames: number;
      previous?: { startFrame: number; durationFrames: number };
    }
  | { type: "CREATE_VARIANT"; clipId: string; variantId: string; name: string }
  | { type: "SET_ACTIVE_VARIANT"; clipId: string; variantId: string; previous?: string }
  | { type: "INVALIDATE_CACHE"; nodeId: string }
  | { type: "REQUEST_RENDER"; clipId: string; quality: "proxy" | "final" }
  | { type: "CANCEL_RENDER"; jobId: string }
  | { type: "LINK_CLIP_WORLD"; clipId: string; worldId: string | null }
  | {
      type: "APPLY_CAMERA_RIG";
      clipId: string;
      preset: CameraRigPreset;
      durationFrames: number;
      startPosition: [number, number, number];
      startRotation: [number, number, number];
      focalLengthMm?: number;
      restore?: {
        rigParameters: Record<string, unknown> | null;
        pathParameters?: Record<string, unknown>;
        createdRig: boolean;
        rigNodeId: string;
        pathNodeId: string;
      };
    }
  | {
      /** Add a camera keyframe at t with position + quaternion (6DoF). */
      type: "ADD_CAMERA_KEYFRAME";
      clipId: string;
      t: number;
      position: [number, number, number];
      quaternion: [number, number, number, number];
      /** Optional; when omitted, lens node focal length is used. */
      focalLengthMm?: number;
      focusDistanceM?: number;
      aperture?: number;
    }
  | {
      /** Update or insert a camera keyframe at t with position + quaternion (6DoF). */
      type: "UPDATE_CAMERA_KEYFRAME";
      clipId: string;
      t: number;
      position: [number, number, number];
      quaternion: [number, number, number, number];
      focalLengthMm?: number;
      focusDistanceM?: number;
      aperture?: number;
      /** When present, used to compute inverse precisely. */
      previous?: {
        position: [number, number, number];
        quaternion: [number, number, number, number];
        focalLengthMm?: number;
        focusDistanceM?: number;
        aperture?: number;
      };
    }
  | {
      /** Remove camera keyframe at t if present. */
      type: "REMOVE_CAMERA_KEYFRAME";
      clipId: string;
      t: number;
      /** Optional previous payload for precise inverse. */
      previous?: {
        position: [number, number, number];
        quaternion: [number, number, number, number];
        focalLengthMm?: number;
        focusDistanceM?: number;
        aperture?: number;
      };
    }
  | {
      /** Apply a batch of domain commands atomically as one undoable unit. */
      type: "APPLY_COMMANDS";
      commands: DomainCommand[];
      /** Optional message for logs/UI; callers may log separately. */
      logMessage?: string;
    }
  // ClipDraft commands — generation drafts are separate from blocking plan
  | { type: "CREATE_CLIP_DRAFT"; clipId: string; modelId?: string }
  | {
      type: "UPDATE_CLIP_DRAFT";
      clipId: string;
      patch: Partial<{
        prompt: string;
        width: number;
        height: number;
        fps: number;
        durationSeconds: number;
        outputCount: number;
        cameraMovementSuggestion?: string;
        references: import("../../domain/generation/clipDraft").DraftReference[];
      }>;
    }
  | { type: "DISCARD_CLIP_DRAFT"; clipId: string }
  | {
      type: "ADD_DRAFT_REFERENCE";
      clipId: string;
      reference: import("../../domain/generation/clipDraft").DraftReference;
    }
  | { type: "REMOVE_DRAFT_REFERENCE"; clipId: string; referenceId: string }
  | { type: "SET_DRAFT_MODEL"; clipId: string; modelId: string }
  | { type: "SET_DRAFT_IMAGE_MODE"; clipId: string; referenceId: string; mode: "reference" | "hard" }
  | { type: "SET_DRAFT_IMAGE_GUIDANCE"; clipId: string; referenceId: string; guidance: number };

export type DomainEventType =
  | "NodeCreated"
  | "NodeDeleted"
  | "NodeParamsChanged"
  | "NodeUiChanged"
  | "NodeReferenceChanged"
  | "NodeMarkedDirty"
  | "ClipTimingChanged"
  | "VariantChanged"
  | "AssetVersionChanged"
  | "CacheInvalidated"
  | "RenderQueued"
  | "RenderCompleted"
  | "RenderFailed";

export interface DomainEvent {
  type: DomainEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  command: DomainCommand;
  inverse?: DomainCommand;
  events: DomainEvent[];
  reason?: string;
}
