import { describe, expect, it } from "vitest";
import { shotFps, toFrame } from "./toFrame";

describe("toFrame", () => {
  it("converts 2 seconds at 24fps to frame 48", () => {
    expect(toFrame(2, 24)).toBe(48);
  });

  it("converts 2.5 seconds at 24fps to frame 60", () => {
    expect(toFrame(2.5, 24)).toBe(60);
  });

  it("maps 0 seconds to frame 0", () => {
    expect(toFrame(0, 24)).toBe(0);
  });

  it("clamps negative time to frame 0", () => {
    expect(toFrame(-0.5, 24)).toBe(0);
    expect(toFrame(-2.5, 30)).toBe(0);
  });

  it("treats NaN time as frame 0", () => {
    expect(toFrame(Number.NaN, 24)).toBe(0);
  });

  it("converts with a non-24 shot fps", () => {
    expect(toFrame(2, 30)).toBe(60);
    expect(toFrame(2.5, 30)).toBe(75);
  });

  it("falls back to the default fps when the rate is not usable", () => {
    expect(toFrame(2, Number.NaN)).toBe(48);
    expect(toFrame(2, 0)).toBe(48);
  });
});

describe("shotFps", () => {
  it("reads Shot.fps when present", () => {
    expect(shotFps({ fps: 30 })).toBe(30);
  });

  it("uses the existing default when Shot.fps is missing or invalid", () => {
    expect(shotFps(undefined)).toBe(24);
    expect(shotFps({})).toBe(24);
    expect(shotFps({ fps: Number.NaN })).toBe(24);
  });
});
