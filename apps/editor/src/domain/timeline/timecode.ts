/**
 * Shot-local clock.
 *
 * The only rate is `Shot.time.fps`, and it must be a positive integer.
 * Frames are integers. Timecode is non-drop-frame `HH:MM:SS:FF`.
 * Drop-frame (semicolon, 29.97, 59.94) is out of scope and rejected.
 *
 * Two second conversions stay separate:
 * - `secondsToFrame` / `sampleTimeToShotFrame` pick the nearest frame. Ties round half up (toward +∞).
 * - `frameContainingSeconds` is the playback interval `[frame / fps, (frame + 1) / fps)`.
 */

export class TimelineClockError extends Error {
  readonly code: "fps" | "frame" | "timecode" | "sample";

  constructor(code: TimelineClockError["code"], message: string) {
    super(message);
    this.name = "TimelineClockError";
    this.code = code;
  }
}

/** A recorded sample time before it is placed on the shot clock. */
export type RecordedSampleTime =
  | { unit: "seconds"; seconds: number }
  | { unit: "sample"; index: number; recordingFps: number };

const pad = (value: number): string => String(value).padStart(2, "0");

/** Positive integer frame rate. Fractional and drop-frame rates are not a shot clock. */
export const isPositiveIntegerFps = (fps: number): boolean => Number.isInteger(fps) && fps > 0;

const assertFps = (fps: number): void => {
  if (!isPositiveIntegerFps(fps)) {
    throw new TimelineClockError("fps", "fps must be a positive integer. Drop-frame timecode is not supported.");
  }
};

const assertFrame = (frame: number): void => {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new TimelineClockError("frame", "Frame must be a non-negative integer.");
  }
};

const assertSeconds = (seconds: number): void => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new TimelineClockError("frame", "Seconds must be a non-negative finite number.");
  }
};

/** Integer division, ties toward +∞. Numerator and denominator are non-negative. */
const roundHalfUp = (numerator: number, denominator: number): number => {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
};

/** `HH:MM:SS:FF` for one shot-local frame. */
export const frameToTimecode = (frame: number, fps: number): string => {
  assertFps(fps);
  assertFrame(frame);
  const frames = frame % fps;
  const totalSeconds = Math.floor(frame / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
};

/** Inverse of {@link frameToTimecode}. The frame field must be inside `0 .. fps - 1`. */
export const timecodeToFrame = (timecode: string, fps: number): number => {
  assertFps(fps);
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d):(\d{2,})$/.exec(timecode);
  if (!match) {
    throw new TimelineClockError("timecode", "Timecode must be non-drop-frame HH:MM:SS:FF.");
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[4]);
  if (frames >= fps) {
    throw new TimelineClockError("timecode", "Timecode frame field is outside this fps.");
  }
  return ((hours * 60 + minutes) * 60 + seconds) * fps + frames;
};

/** Start of a shot-local frame, in seconds. */
export const frameToSeconds = (frame: number, fps: number): number => {
  assertFps(fps);
  assertFrame(frame);
  return frame / fps;
};

/**
 * Nearest shot-local frame for a seconds timestamp.
 * Uses `Math.round` (half up, ties toward +∞). An integer frame survives `frameToSeconds` then this call.
 */
export const secondsToFrame = (seconds: number, fps: number): number => {
  assertFps(fps);
  assertSeconds(seconds);
  return Math.round(seconds * fps);
};

/**
 * Frame whose half-open interval contains a playback time on the shot clock.
 * This is not the nearest-frame map used for recorded samples.
 */
export const frameContainingSeconds = (seconds: number, fps: number): number => {
  assertFps(fps);
  assertSeconds(seconds);
  return Math.floor(seconds * fps);
};

/**
 * Map a recorded sample onto a shot-local frame.
 *
 * `Shot.time.fps` and, for a sample index, the recording fps must be positive integers.
 * A sample index `i` lands on round-half-up(`i * shotFps / recordingFps`).
 * Ties go to the greater frame. Equal rates therefore keep the index.
 * A seconds timestamp uses {@link secondsToFrame}.
 * Does not resample to 30fps. That belongs to the video lane.
 */
export const sampleTimeToShotFrame = (sample: RecordedSampleTime, shotFps: number): number => {
  assertFps(shotFps);
  if (sample.unit === "seconds") return secondsToFrame(sample.seconds, shotFps);
  assertFps(sample.recordingFps);
  if (!Number.isInteger(sample.index) || sample.index < 0) {
    throw new TimelineClockError("sample", "Sample index must be a non-negative integer.");
  }
  return roundHalfUp(sample.index * shotFps, sample.recordingFps);
};

/**
 * Shot-local frame for a sequence playhead.
 * Same index the playback readout and the viewport take sampler use.
 * Half-up, then clamped into `[0, durationFrames)` when a duration is present.
 */
export const shotLocalFrame = (input: {
  playhead: number;
  clipStartFrame: number;
  durationFrames?: number;
}): number => {
  const playhead = Number.isFinite(input.playhead) ? input.playhead : 0;
  const start = Number.isFinite(input.clipStartFrame) ? input.clipStartFrame : 0;
  const local = Math.max(0, Math.round(playhead - start));
  const duration = input.durationFrames;
  if (typeof duration === "number" && Number.isInteger(duration) && duration > 0) {
    return Math.min(duration - 1, local);
  }
  return local;
};
