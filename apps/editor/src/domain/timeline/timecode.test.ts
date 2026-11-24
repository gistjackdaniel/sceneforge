import { describe, expect, it } from "vitest";
import {
  TimelineClockError,
  frameContainingSeconds,
  frameToSeconds,
  frameToTimecode,
  sampleTimeToShotFrame,
  secondsToFrame,
  shotLocalFrame,
  timecodeToFrame,
} from "./timecode";

/** Phase 0 shot: 8 seconds at 16fps is 128 frames. */
const PHASE0 = { seconds: 8, fps: 16, frames: 128 } as const;

describe("shot timecode", () => {
  it("round-trips every frame of the 8s 16fps shot", () => {
    expect(PHASE0.seconds * PHASE0.fps).toBe(PHASE0.frames);
    for (let frame = 0; frame < PHASE0.frames; frame += 1) {
      expect(timecodeToFrame(frameToTimecode(frame, PHASE0.fps), PHASE0.fps)).toBe(frame);
      expect(secondsToFrame(frameToSeconds(frame, PHASE0.fps), PHASE0.fps)).toBe(frame);
    }
    expect(frameToTimecode(0, 16)).toBe("00:00:00:00");
    expect(frameToTimecode(16, 16)).toBe("00:00:01:00");
    expect(frameToTimecode(127, 16)).toBe("00:00:07:15");
    expect(frameToTimecode(128, 16)).toBe("00:00:08:00");
    expect(frameToSeconds(128, 16)).toBe(8);
  });

  it("crosses the 24fps and 30fps second boundaries", () => {
    expect(frameToTimecode(23, 24)).toBe("00:00:00:23");
    expect(frameToTimecode(24, 24)).toBe("00:00:01:00");
    expect(timecodeToFrame("00:00:59:23", 24)).toBe(24 * 60 - 1);
    expect(frameToTimecode(24 * 60, 24)).toBe("00:01:00:00");

    expect(frameToTimecode(29, 30)).toBe("00:00:00:29");
    expect(frameToTimecode(30, 30)).toBe("00:00:01:00");
    expect(timecodeToFrame("00:00:59:29", 30)).toBe(30 * 60 - 1);
    expect(frameToTimecode(30 * 60, 30)).toBe("00:01:00:00");

    for (const fps of [24, 30]) {
      for (const frame of [0, fps - 1, fps, fps * 60 - 1, fps * 60]) {
        expect(timecodeToFrame(frameToTimecode(frame, fps), fps)).toBe(frame);
        expect(secondsToFrame(frameToSeconds(frame, fps), fps)).toBe(frame);
      }
    }
  });

  it("rejects non-integer fps, drop-frame, and a frame field past the rate", () => {
    expect(() => frameToTimecode(0, 23.976)).toThrow(TimelineClockError);
    expect(() => secondsToFrame(1, 29.97)).toThrow(TimelineClockError);
    expect(() => timecodeToFrame("00:00:01;00", 30)).toThrow(TimelineClockError);
    expect(() => timecodeToFrame("00:00:00:16", 16)).toThrow(TimelineClockError);
    expect(() => frameToTimecode(1.5, 24)).toThrow(TimelineClockError);
  });
});

describe("recorded sample to shot frame", () => {
  it("keeps a 16fps take index on the 16fps shot", () => {
    for (const index of [0, 1, 15, 16, 127, 128]) {
      expect(sampleTimeToShotFrame({ unit: "sample", index, recordingFps: 16 }, 16)).toBe(index);
    }
    expect(sampleTimeToShotFrame({ unit: "seconds", seconds: 8 }, 16)).toBe(128);
    expect(sampleTimeToShotFrame({ unit: "seconds", seconds: 0 }, 16)).toBe(0);
  });

  it("rounds to the nearest shot frame when the recording rate differs, ties upward", () => {
    expect(sampleTimeToShotFrame({ unit: "sample", index: 30, recordingFps: 30 }, 24)).toBe(24);
    expect(sampleTimeToShotFrame({ unit: "sample", index: 29, recordingFps: 30 }, 24)).toBe(23);
    expect(sampleTimeToShotFrame({ unit: "sample", index: 1, recordingFps: 30 }, 24)).toBe(1);
    expect(sampleTimeToShotFrame({ unit: "sample", index: 24, recordingFps: 24 }, 30)).toBe(30);
    expect(sampleTimeToShotFrame({ unit: "sample", index: 1, recordingFps: 24 }, 30)).toBe(1);
    expect(sampleTimeToShotFrame({ unit: "sample", index: 1, recordingFps: 16 }, 24)).toBe(2);
    expect(secondsToFrame(1.5, 24)).toBe(36);
  });

  it("is deterministic for the same sample", () => {
    const sample = { unit: "sample" as const, index: 127, recordingFps: 16 };
    expect(sampleTimeToShotFrame(sample, 16)).toBe(sampleTimeToShotFrame(sample, 16));
    expect(() => sampleTimeToShotFrame({ unit: "sample", index: 1, recordingFps: 23.976 }, 24)).toThrow(TimelineClockError);
    expect(() => sampleTimeToShotFrame({ unit: "seconds", seconds: -0.1 }, 16)).toThrow(TimelineClockError);
  });
});

describe("playback frame index", () => {
  it("uses one shot-local frame for the readout and the viewport", () => {
    const durationFrames = PHASE0.frames;
    const frame = shotLocalFrame({ playhead: 127, clipStartFrame: 0, durationFrames });
    expect(frame).toBe(127);
    expect(frameToTimecode(frame, PHASE0.fps)).toBe("00:00:07:15");
    expect(shotLocalFrame({ playhead: 12, clipStartFrame: 12, durationFrames })).toBe(0);
    expect(shotLocalFrame({ playhead: 200, clipStartFrame: 0, durationFrames })).toBe(127);
    expect(shotLocalFrame({ playhead: 10.5, clipStartFrame: 0, durationFrames })).toBe(11);
    expect(frameContainingSeconds(7 + 15 / 16, 16)).toBe(127);
    expect(frameContainingSeconds(8, 16)).toBe(128);
  });
});
