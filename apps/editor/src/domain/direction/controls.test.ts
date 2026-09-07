import { describe, expect, it } from "vitest";
import {
  mergeDirectionInvalidations,
  normalizeDirectionChannelControls,
} from "./controls";

describe("direction channel controls", () => {
  it("normalizes persisted controls and clamps strength", () => {
    const controls = normalizeDirectionChannelControls({
      camera: { locked: false, strength: 4 },
      performance_body: { strength: -1, mask: { uri: "masks/body.png" } },
    });

    expect(controls.camera).toMatchObject({ channel: "camera", locked: false, strength: 1 });
    expect(controls.performance_body.strength).toBe(0);
    expect(controls.performance_body.mask?.uri).toBe("masks/body.png");
    expect(controls.audio.locked).toBe(true);
  });

  it("merges overlapping frame ranges and lets full invalidation win", () => {
    expect(
      mergeDirectionInvalidations(
        [{ channel: "performance_body", frameRanges: [{ startFrame: 4, endFrame: 12 }] }],
        [{ channel: "performance_body", frameRanges: [{ startFrame: 10, endFrame: 18 }] }],
      ),
    ).toEqual([
      { channel: "performance_body", frameRanges: [{ startFrame: 4, endFrame: 18 }] },
    ]);

    expect(
      mergeDirectionInvalidations(
        [{ channel: "audio", frameRanges: [{ startFrame: 0, endFrame: 12 }] }],
        [{ channel: "audio" }],
      ),
    ).toEqual([{ channel: "audio" }]);
  });
});

