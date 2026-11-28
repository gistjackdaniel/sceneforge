import { describe, expect, it } from "vitest";
import { parseShot, shotFps } from "../shot";
import { shotFpsForClip } from "./shotClock";

const shotAt = (fps: number) => parseShot({
  schemaVersion: 1,
  id: "clip-room",
  name: "Room",
  time: { fps, durationFrames: 75, origin: "clip_local" },
  subjects: [],
  camera: { status: "empty", lens: { focalLengthMm: 35 }, interpolation: "linear" },
  renders: [],
});

describe("Shot.time.fps", () => {
  it("reads the shot record rate and keeps frames integral", () => {
    const shot = shotAt(30);
    expect(shot.time.origin).toBe("clip_local");
    expect(shot.time.fps).toBe(30);
    expect(Number.isInteger(shot.time.durationFrames)).toBe(true);
    expect(shot.time.durationFrames / shotFps(shot)).toBe(2.5);
    const withStaleRate = { time: { fps: 30 }, fps: 12 };
    expect(shotFps(withStaleRate)).toBe(30);
  });

  it("prefers Shot.time.fps over a different sequence rate", () => {
    const shot = shotAt(30);
    const project = {
      activeSequenceId: "seq",
      shots: { [shot.id]: shot },
      sequences: {
        seq: { id: "seq", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, 75] as [number, number], fps: 24 },
      },
    };
    expect(shotFpsForClip(project, shot.id)).toBe(30);
  });

  it("uses sequence fps only when the clip has no shot", () => {
    const project = {
      activeSequenceId: "seq",
      sequences: {
        seq: { id: "seq", name: "Main", clipIds: ["clip-room"], playhead: 0, visibleRange: [0, 48] as [number, number], fps: 30 },
      },
    };
    expect(shotFpsForClip(project, "clip-room")).toBe(30);
    expect(shotFps(undefined)).toBe(24);
  });
});
