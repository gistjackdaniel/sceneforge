import { describe, expect, it } from "vitest";
import { cameraExportTiming, frameToTimecode, resolveAuthoringFps } from "./authoringFps";

describe("authoring fps", () => {
  it("reads one fps for recording and export, preferring a future Shot.fps", () => {
    expect(resolveAuthoringFps()).toBe(24);
    expect(resolveAuthoringFps({ sequence: { fps: 30 } })).toBe(30);
    expect(resolveAuthoringFps({ shot: { fps: 25 }, sequence: { fps: 30 } })).toBe(25);
    expect(resolveAuthoringFps({ override: 16, shot: { fps: 25 } })).toBe(16);
    expect(resolveAuthoringFps({ sequence: { fps: 0 }, shot: {} })).toBe(24);
  });

  it("reports when an explicit export override leaves the authoring rate", () => {
    expect(cameraExportTiming({ sequence: { fps: 24 } })).toEqual({
      fps: 24,
      sourceFps: 24,
      resampled: false,
    });
    expect(cameraExportTiming({ override: 16, sequence: { fps: 24 } })).toEqual({
      fps: 16,
      sourceFps: 24,
      resampled: true,
    });
  });

  it("formats shot-local timecode from the authoring rate", () => {
    expect(frameToTimecode(0, 24)).toBe("00:00:00:00");
    expect(frameToTimecode(24, 24)).toBe("00:00:01:00");
    expect(frameToTimecode(23, 24)).toBe("00:00:00:23");
  });
});
