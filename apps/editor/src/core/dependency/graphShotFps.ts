import { readShotTimeFps } from "../../domain/shot/queries";
import type { Shot } from "../../domain/shot/types";

/** `Shot.time.fps` is missing or not a positive finite number. */
export type MissingShotFpsError = {
  ok: false;
  error: "missing_shot_fps";
  message: string;
};

export type GraphShotFps = { ok: true; fps: number } | MissingShotFpsError;

const missingShotFps = (): MissingShotFpsError => ({
  ok: false,
  error: "missing_shot_fps",
  message: "Shot.time.fps가 없거나 양수가 아닙니다.",
});

/**
 * Frame rate stored on a graph pass.
 *
 * The number is always `readShotTimeFps(shot)`. Display clocks `shotFps` and
 * `shotFpsForClip` are not read, and a missing rate is not replaced.
 * `readShotTimeFps` throws when `Shot.time.fps` is missing or not a positive
 * finite number. The same check runs first, so this returns
 * `{ ok: false, error: "missing_shot_fps" }` instead of that throw.
 * Does not write the shot.
 */
export const readGraphShotFps = (shot: Pick<Shot, "time">): GraphShotFps => {
  const rate = shot.time.fps;
  if (!(typeof rate === "number" && Number.isFinite(rate) && rate > 0)) {
    return missingShotFps();
  }
  return { ok: true, fps: readShotTimeFps(shot) };
};
