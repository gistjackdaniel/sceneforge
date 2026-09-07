import { describe, expect, it } from "vitest";
import { validateCameraContinuity } from "./continuity";

const actors = [
  { id: "a", position: [0, 0, 0] as [number, number, number] },
  { id: "b", position: [4, 0, 0] as [number, number, number] },
];

describe("180-degree continuity validation", () => {
  it("reports frames that leave the protected side", () => {
    const result = validateCameraContinuity(
      [
        { frame: 0, position: [2, 1.7, 3] },
        { frame: 24, position: [2, 1.7, -2] },
      ],
      actors,
      {
        lineOfActionLabel: "A to B",
        lineActorAId: "a",
        lineActorBId: "b",
        cameraSide: "left",
        screenDirection: "left_to_right",
      },
    );

    expect(result.status).toBe("invalid");
    expect(result.samples.map((sample) => sample.side)).toEqual(["left", "right"]);
    expect(result.violationFrames).toEqual([24]);
  });

  it("warns about an intentional crossing when the side is unlocked", () => {
    const result = validateCameraContinuity(
      [
        { frame: 0, position: [2, 1.7, 3] },
        { frame: 24, position: [2, 1.7, -2] },
      ],
      actors,
      {
        lineOfActionLabel: "A to B",
        lineActorAId: "a",
        lineActorBId: "b",
        cameraSide: "unlocked",
        screenDirection: "neutral",
      },
    );

    expect(result.status).toBe("warning");
    expect(result.violationFrames).toEqual([]);
  });
});

