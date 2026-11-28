import type { MobileCameraSession } from "../domain/shot/mobileSession";
import type { MobilePairSettings } from "../domain/shot/mobileCaptureProtocol";
import { secondsToFrame } from "../domain/timeline/timecode";

type Sample = MobileCameraSession["frames"][number];
export type PhoneReading = { trackingState: "tracked" | "emulated"; pose: Sample["pose"] } | { trackingState: "lost" };
type CaptureUpdate = { kind: "waiting" | "complete" } | { kind: "recording"; seconds: number };

export function createPhoneTakeRecorder(settings: MobilePairSettings) {
  const frames = new Map<number, Sample>();
  let originNs: number | undefined;
  let lastSample: Sample | undefined;

  const frameAt = (timestampNs: number, origin: number) => secondsToFrame((timestampNs - origin) / 1e9, settings.fps);
  const markGap = () => {
    if (originNs === undefined || !lastSample) return;
    const missingAt = frameAt(lastSample.timestampNs, originNs) + 1;
    if (missingAt < settings.durationFrames) {
      frames.set(missingAt, { ...lastSample, timestampNs: originNs + Math.round(missingAt * 1e9 / settings.fps), trackingState: "lost" });
    }
  };

  return {
    markGap,
    frames: () => [...frames.values()],
    observe(timestampMs: number, reading: PhoneReading): CaptureUpdate {
      const timestampNs = Math.round(timestampMs * 1e6);
      if (originNs === undefined) {
        if (reading.trackingState !== "tracked") return { kind: "waiting" };
        originNs = timestampNs;
      }
      if (lastSample && timestampNs - lastSample.timestampNs > Math.max(150, 2000 / settings.fps) * 1e6) markGap();
      const frame = frameAt(timestampNs, originNs);
      if (frame >= settings.durationFrames) return { kind: "complete" };
      const pose = reading.trackingState === "lost" ? lastSample?.pose : reading.pose;
      if (pose) {
        lastSample = { timestampNs, pose, trackingState: reading.trackingState };
        if (frame !== 0 || !frames.has(0)) frames.set(frame, lastSample);
      }
      return { kind: "recording", seconds: (timestampNs - originNs) / 1e9 };
    },
  };
}
