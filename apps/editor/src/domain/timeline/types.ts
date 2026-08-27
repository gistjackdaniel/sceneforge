import type { CacheStatus } from "../rendering/types";
import type { WorldMode } from "../worlds/types";

export type ClipSourceType = "empty" | "video" | "generated";

export interface ClipVariant {
  id: string;
  name: string;
  /** Node-id keyed param patches. Does not clone the clip graph (PRD §10.3). */
  overridePatch: Record<string, unknown>;
}

export interface TimelineClip {
  id: string;
  name: string;
  trackId?: string;
  /** Legacy timing (frames in current editor). Prefer startFrame/durationFrames. */
  start: number;
  end: number;
  duration: number;
  startFrame?: number;
  durationFrames?: number;
  sourceInFrame?: number;
  playbackRate?: number;
  sourceType: ClipSourceType;
  linkedWorldId?: string;
  clipGraphId: string;
  /** PRD field; replaces legacy cameraTrajectoryNodeId */
  cameraPathNodeId?: string;
  /** @deprecated use cameraPathNodeId */
  cameraTrajectoryNodeId?: string;
  renderCacheNodeId?: string;
  graphSnapshotId?: string;
  cacheStatus: CacheStatus;
  worldMode?: WorldMode;
  variant?: string;
  activeVariantId?: string;
  variants?: ClipVariant[];
  /** Clip-scoped world override patch (PRD §2.5) */
  worldOverride?: Record<string, unknown>;
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
  fps?: number;
  /** Sequence-scoped world override patch (PRD §2.5) */
  worldOverride?: Record<string, unknown>;
}
