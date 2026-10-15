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
    };

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
