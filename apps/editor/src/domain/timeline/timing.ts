import type { TimelineClip } from "./types";

export const DEFAULT_CLIP_FPS = 24;

/** Prefer explicit frame fields; fall back to legacy start/duration (already frame-like in editor). */
export const clipStartFrame = (clip: Pick<TimelineClip, "startFrame" | "start">): number =>
  clip.startFrame ?? clip.start ?? 0;

export const clipDurationFrames = (
  clip: Pick<TimelineClip, "durationFrames" | "duration">,
): number => clip.durationFrames ?? clip.duration ?? 0;

export const clipEndFrame = (clip: TimelineClip): number =>
  clipStartFrame(clip) + clipDurationFrames(clip);

export const withClipTiming = (
  clip: TimelineClip,
  startFrame: number,
  durationFrames: number,
): TimelineClip => {
  const safeDuration = Math.max(1, Math.round(durationFrames));
  const safeStart = Math.max(0, Math.round(startFrame));
  return {
    ...clip,
    startFrame: safeStart,
    durationFrames: safeDuration,
    sourceInFrame: clip.sourceInFrame ?? 0,
    playbackRate: clip.playbackRate ?? 1,
    start: safeStart,
    duration: safeDuration,
    end: safeStart + safeDuration,
  };
};

/** Seconds-based legacy payloads → frame fields. Values already in frames are left as-is. */
export const migrateClipTiming = (clip: TimelineClip, fps = DEFAULT_CLIP_FPS): TimelineClip => {
  if (clip.startFrame !== undefined && clip.durationFrames !== undefined) {
    return withClipTiming(clip, clip.startFrame, clip.durationFrames);
  }
  const looksLikeSeconds = clip.duration > 0 && clip.duration < 20 && !Number.isInteger(clip.duration);
  const startFrame = looksLikeSeconds ? Math.round(clip.start * fps) : Math.round(clip.start);
  const durationFrames = looksLikeSeconds ? Math.round(clip.duration * fps) : Math.round(clip.duration);
  return withClipTiming(
    {
      ...clip,
      sourceInFrame: clip.sourceInFrame ?? 0,
      playbackRate: clip.playbackRate ?? 1,
      trackId: clip.trackId ?? "V1",
    },
    startFrame,
    durationFrames,
  );
};
