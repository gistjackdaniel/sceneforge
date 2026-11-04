import { z } from "zod";
import { adoptShotEditorial, shotApprovalSchema, shotOverrideEventSchema, shotRevisionSchema } from "./shotEditorial";
import { assetRevisionRefFromRecord, shotSceneSchema, type AssetRevisionRef } from "./shotScene";
import { PERSISTENT_ID_PATTERN, isPersistentId, legacyShotId } from "./persistentId";
import { DEFAULT_CLIP_FPS, clipDurationFrames } from "./timing";
import type { Sequence, TimelineClip } from "./types";

/**
 * Migration default only. Once `Shot.fps` is stored, readers use that field.
 * 24 matches the editor clock (`DEFAULT_CLIP_FPS`). Backbone's export default of 16 is not used here.
 */
export const DEFAULT_SHOT_FPS = DEFAULT_CLIP_FPS;

export const shotTimeRangeSchema = z
  .object({
    /** Inclusive shot-local frame. 0 is the first frame of the shot, not the sequence playhead. */
    startFrame: z.number().int().nonnegative(),
    /** Exclusive shot-local frame. */
    endFrame: z.number().int().positive(),
  })
  .refine((range) => range.endFrame > range.startFrame, "shot time range must be non-empty");

export type ShotTimeRange = z.infer<typeof shotTimeRangeSchema>;

/**
 * Production record for one timeline clip.
 * The clip keeps sequence placement (`startFrame` on the sequence). This document owns the
 * canonical frame rate and the shot-local range that Scene (camera) and Video (resample) read.
 */
export const shotSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(PERSISTENT_ID_PATTERN, "persistent id"),
    clipId: z.string().min(1),
    /** Canonical frames per second. Single source for camera record/export and video resample. */
    fps: z.number().int().positive(),
    timeRange: shotTimeRangeSchema,
    /** Original scene. Override commands must not replace this object. */
    scene: shotSceneSchema,
    overrides: z.array(shotOverrideEventSchema),
    revisions: z.array(shotRevisionSchema).min(1),
    headRevisionId: z.string().min(1),
    /** Present so approval history has a place to land. Phase 1 does not write it from the UI. */
    approvals: z.array(shotApprovalSchema),
  })
  .superRefine((shot, ctx) => {
    const head = shot.revisions.find((revision) => revision.id === shot.headRevisionId);
    if (!head) {
      ctx.addIssue({ code: "custom", message: "head revision missing" });
      return;
    }
    if (JSON.stringify(head.overrides) !== JSON.stringify(shot.overrides)) {
      ctx.addIssue({ code: "custom", message: "head overrides diverged" });
    }
  });

export type Shot = z.infer<typeof shotSchema>;

const looseShotSchema = z
  .object({
    id: z.string().optional(),
    clipId: z.string().optional(),
    fps: z.number().optional(),
    timeRange: z
      .object({
        startFrame: z.number().optional(),
        endFrame: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export interface ShotClockSource {
  shots?: Record<string, Shot>;
  clips: Record<string, Pick<TimelineClip, "shotId">>;
  sequences?: Record<string, Pick<Sequence, "clipIds" | "fps">>;
}

/**
 * Declared sequence rate, or {@link DEFAULT_SHOT_FPS} when the sequence has no usable fps.
 * Pure. Does not read `Shot.fps` and does not invalidate caches.
 */
export const fpsFromLegacySequence = (fps: number | undefined): number =>
  typeof fps === "number" && Number.isInteger(fps) && fps > 0 ? fps : DEFAULT_SHOT_FPS;

/**
 * Canonical fps. No defaulting — a parsed Shot always has a positive integer.
 * Side effect: none. Downstream cache keys are unchanged by reading this.
 */
export const shotFps = (shot: Pick<Shot, "fps">): number => shot.fps;

/** Shot-local `[startFrame, endFrame)`. Side effect: none. */
export const shotTimeRange = (shot: Pick<Shot, "timeRange">): ShotTimeRange => shot.timeRange;

/** Number of shot-local frames in the range. Side effect: none. */
export const shotFrameCount = (shot: Pick<Shot, "timeRange">): number =>
  shot.timeRange.endFrame - shot.timeRange.startFrame;

/**
 * Convert a shot-local frame index to seconds using the shot's own fps.
 * Side effect: none. Video resample and camera export should call this (or `shotFps`) instead of a local constant.
 */
export const frameToShotSeconds = (frame: number, shot: Pick<Shot, "fps">): number => frame / shotFps(shot);

/** Find the shot bound to a clip. Side effect: none. */
export const shotForClip = (source: ShotClockSource, clipId: string): Shot | undefined => {
  const shots = source.shots ?? {};
  const linkedId = source.clips[clipId]?.shotId;
  const linked = linkedId ? shots[linkedId] : undefined;
  if (linked && linked.clipId === clipId) {
    return linked;
  }
  return Object.values(shots).find((shot) => shot.clipId === clipId);
};

/**
 * Fps for a clip. Prefers `Shot.fps`. Falls back to the legacy sequence rate only when the shot
 * document has not been migrated yet. Side effect: none. Does not write state or invalidate caches.
 */
export const shotFpsForClip = (source: ShotClockSource, clipId: string): number => {
  const shot = shotForClip(source, clipId);
  if (shot) {
    return shotFps(shot);
  }
  const sequence = Object.values(source.sequences ?? {}).find((item) => item.clipIds.includes(clipId));
  return fpsFromLegacySequence(sequence?.fps);
};

const sequenceForClip = (
  sequences: Record<string, Pick<Sequence, "clipIds" | "fps">>,
  clipId: string,
): Pick<Sequence, "clipIds" | "fps"> | undefined =>
  Object.values(sequences).find((sequence) => sequence.clipIds.includes(clipId));

/**
 * Build a shot whose range is shot-local `[0, duration)`.
 * Does not mutate the clip. An explicit `fps` wins; otherwise the legacy sequence rate is copied once.
 */
export const createShotForClip = (input: {
  clip: Pick<TimelineClip, "id" | "durationFrames" | "duration">;
  sequenceFps?: number;
  fps?: number;
  id?: string;
  createdAt?: string;
  assetRefs?: readonly AssetRevisionRef[];
  revisionId?: string;
}): Shot => {
  const duration = Math.max(1, Math.round(clipDurationFrames(input.clip)));
  const fps = input.fps ?? fpsFromLegacySequence(input.sequenceFps);
  const id = input.id ?? legacyShotId(input.clip.id);
  const editorial = adoptShotEditorial(undefined, {
    shotId: id,
    createdAt: input.createdAt ?? "1970-01-01T00:00:00.000Z",
    assetRefs: input.assetRefs ?? [],
  });
  if (input.revisionId) {
    editorial.revisions = [{ ...editorial.revisions[0], id: input.revisionId }];
    editorial.headRevisionId = input.revisionId;
  }
  return shotSchema.parse({
    schemaVersion: 1,
    id,
    clipId: input.clip.id,
    fps,
    timeRange: { startFrame: 0, endFrame: duration },
    ...editorial,
  });
};

/**
 * Keep shot-local length equal to the clip duration. `startFrame` is preserved.
 * Does not change fps. Does not mutate the input.
 */
export const withShotFrameLength = (shot: Shot, durationFrames: number): Shot => {
  const length = Math.max(1, Math.round(durationFrames));
  return {
    ...shot,
    timeRange: {
      startFrame: shot.timeRange.startFrame,
      endFrame: shot.timeRange.startFrame + length,
    },
  };
};

const repairShot = (
  existing: unknown,
  clip: TimelineClip,
  sequenceFps: number | undefined,
  timestamp: string,
  assetRefs: readonly AssetRevisionRef[],
): Shot => {
  const loose = looseShotSchema.safeParse(existing);
  const parsed = loose.success ? loose.data : undefined;
  const id = parsed?.id && isPersistentId(parsed.id) ? parsed.id : legacyShotId(clip.id);
  const fps =
    typeof parsed?.fps === "number" && Number.isInteger(parsed.fps) && parsed.fps > 0
      ? parsed.fps
      : fpsFromLegacySequence(sequenceFps);
  const duration = Math.max(1, Math.round(clipDurationFrames(clip)));
  const rawStart = parsed?.timeRange?.startFrame;
  const startFrame =
    typeof rawStart === "number" && Number.isInteger(rawStart) && rawStart >= 0 ? rawStart : 0;
  const editorial = adoptShotEditorial(existing, { shotId: id, createdAt: timestamp, assetRefs });
  return shotSchema.parse({
    schemaVersion: 1,
    id,
    clipId: clip.id,
    fps,
    timeRange: { startFrame, endFrame: startFrame + duration },
    ...editorial,
  });
};

/**
 * Ensure every clip has one Shot. Existing valid fps is kept (the shot is canonical after the first write).
 * Orphan shots whose clip is gone are dropped. Pure with respect to worlds, nodes, and the dependency map:
 * it does not invalidate caches and does not retarget `clipGraphId`.
 */
export const ensureShotsForClips = (input: {
  clips: Record<string, TimelineClip>;
  sequences: Record<string, Sequence>;
  shots?: Record<string, unknown>;
  assets?: Record<string, { id: string; version: number }>;
  timestamp?: string;
}): { clips: Record<string, TimelineClip>; shots: Record<string, Shot> } => {
  const incoming = { ...(input.shots ?? {}) };
  const clips: Record<string, TimelineClip> = { ...input.clips };
  const shots: Record<string, Shot> = {};
  const timestamp = input.timestamp ?? "1970-01-01T00:00:00.000Z";

  for (const clip of Object.values(clips)) {
    const sequenceFps = sequenceForClip(input.sequences, clip.id)?.fps;
    const linked = clip.shotId ? incoming[clip.shotId] : undefined;
    const byClipId = Object.entries(incoming).find(([, value]) => {
      const loose = looseShotSchema.safeParse(value);
      return loose.success && loose.data.clipId === clip.id;
    })?.[1];
    const linkedAssetId = clip.linkedWorldId ? `asset-${clip.linkedWorldId}` : undefined;
    const linkedAsset = linkedAssetId ? input.assets?.[linkedAssetId] : undefined;
    const assetRefs = linkedAsset ? [assetRevisionRefFromRecord(linkedAsset)] : [];
    const shot = repairShot(linked ?? byClipId, clip, sequenceFps, timestamp, assetRefs);
    shots[shot.id] = shot;
    clips[clip.id] = { ...clip, shotId: shot.id };
  }

  return { clips, shots };
};
