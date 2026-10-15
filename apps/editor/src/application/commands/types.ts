import type { NodeBase } from "../../domain/graph/types";
import type { NodeReference, ReferenceType } from "../../domain/graph/references";
import type { GraphEdge } from "../../domain/graph/types";
import type { CameraRigPreset } from "../../domain/graph/cameraRig";

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
  // Pose authoring commands (SMPL-X)
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
      target:
        | { kind: "global_orient" }
        | { kind: "jaw" }
        | { kind: "body"; index: number }
        | { kind: "left_hand"; index: number }
        | { kind: "right_hand"; index: number };
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
