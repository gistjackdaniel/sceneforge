import { DEFAULT_CLIP_FPS } from "../../domain/timeline/timing";

/**
 * Shot timing as stored on the sequence that owns the clip.
 * `fps` is optional; missing or invalid values fall back to {@link DEFAULT_CLIP_FPS}.
 */
export interface ShotTiming {
  fps?: number;
}

/** Frame rate for a shot. Uses `Shot.fps` when it is a positive finite number. */
export const shotFps = (shot: ShotTiming | undefined): number => {
  const fps = shot?.fps;
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) {
    return fps;
  }
  return DEFAULT_CLIP_FPS;
};

/**
 * Convert loop time in seconds to a frame index.
 * Non-finite or negative times become 0. Invalid fps falls back to {@link DEFAULT_CLIP_FPS}.
 */
export const toFrame = (tSeconds: number, fps: number): number => {
  if (!Number.isFinite(tSeconds) || tSeconds <= 0) {
    return 0;
  }
  const rate = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CLIP_FPS;
  return Math.max(0, Math.round(tSeconds * rate));
};
