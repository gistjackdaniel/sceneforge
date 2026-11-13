import { shotFps } from "../../domain/shot/queries";
import { DEFAULT_CLIP_FPS } from "../../domain/timeline/timing";

export { shotFps };

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
