/**
 * Fallback until Timeline stores `Shot.fps`. Recording and Backbone export both read
 * `resolveAuthoringFps` so they cannot drift back to separate 24 and 16 defaults.
 */
export const DEFAULT_AUTHORING_FPS = 24;

/**
 * Read a positive finite `fps` from a shot or sequence object.
 * Returns undefined when the field is absent, so this keeps working before `Shot.fps` exists
 * and picks the field up when Timeline adds it. No cast of the whole object.
 */
export const readPositiveFps = (source: object | null | undefined): number | undefined => {
  if (!source) {
    return undefined;
  }
  const value = Reflect.get(source, "fps");
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export interface AuthoringFpsInput {
  /** Explicit one-off override (tests, a caller that already chose a rate). */
  override?: number;
  /** Future `Shot`. Any object with an optional numeric `fps`. */
  shot?: object | null;
  /** Current `Sequence`, used until the shot carries fps. */
  sequence?: object | null;
}

/**
 * Single fps injection point for camera recording and Backbone export.
 * Priority is explicit override, then `Shot.fps`, then `Sequence.fps`, then 24.
 * Swapping in `Shot.fps` later does not require another call site.
 */
export const resolveAuthoringFps = (input: AuthoringFpsInput = {}): number =>
  readPositiveFps({ fps: input.override }) ??
  readPositiveFps(input.shot) ??
  readPositiveFps(input.sequence) ??
  DEFAULT_AUTHORING_FPS;

/**
 * Timing relationship between the authoring clock and an export call.
 * Backbone v0.1 metadata cannot carry this yet (that schema is owned by the Video lane).
 */
export const cameraExportTiming = (
  input: AuthoringFpsInput = {},
): { fps: number; sourceFps: number; resampled: boolean } => {
  const sourceFps = resolveAuthoringFps({ shot: input.shot, sequence: input.sequence });
  const fps = resolveAuthoringFps(input);
  return { fps, sourceFps, resampled: fps !== sourceFps };
};

/** Shot-local timecode `HH:MM:SS:FF` at the authoring rate. */
export const frameToTimecode = (frame: number, fps: number): string => {
  const rate = Math.max(1, Math.round(fps));
  const whole = Math.max(0, Math.floor(frame));
  const frames = whole % rate;
  const totalSeconds = Math.floor(whole / rate);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
};
