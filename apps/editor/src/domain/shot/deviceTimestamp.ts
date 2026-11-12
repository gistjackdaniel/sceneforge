/**
 * Device monotonic timestamp → shot-local integer frame.
 *
 * Temporary. The Timeline lane (`feat/timeline-fps-timecode-sync`) replaces
 * this function. Callers pass `fps` from `Shot.time.fps` only. This module
 * does not read another frame rate and does not store one on the sample.
 */
export type DeviceTimestampToFrame = (input: {
  deviceTimestampNs: number;
  originTimestampNs: number;
  fps: number;
}) => number;

/** Round the elapsed device time onto the shot clock. Negative results are left negative so the caller can drop them. */
export const deviceTimestampToFrame: DeviceTimestampToFrame = ({ deviceTimestampNs, originTimestampNs, fps }) => {
  if (!(typeof fps === "number" && Number.isFinite(fps) && fps > 0)) {
    throw new Error("fps must be Shot.time.fps.");
  }
  return Math.round(((deviceTimestampNs - originTimestampNs) / 1e9) * fps);
};
