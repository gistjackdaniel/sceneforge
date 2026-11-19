import { describe, expect, it } from "vitest";
import { solveTwoBone } from "./twoBoneIk";

const span = (value: readonly [number, number, number]) => Math.hypot(value[0], value[1], value[2]);

const between = (left: readonly [number, number, number], right: readonly [number, number, number]) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

describe("solveTwoBone", () => {
  it("puts the wrist on a reachable target and keeps both segment lengths", () => {
    const solved = solveTwoBone(0.3, 0.4, [0, -0.5, 0]);
    expect(solved.wrist[0]).toBeCloseTo(0, 4);
    expect(solved.wrist[1]).toBeCloseTo(-0.5, 4);
    expect(solved.wrist[2]).toBeCloseTo(0, 4);
    expect(solved.elbow[0]).toBeCloseTo(0, 4);
    expect(solved.elbow[1]).toBeCloseTo(-0.18, 4);
    expect(solved.elbow[2]).toBeCloseTo(0.24, 4);
    expect(span(solved.elbow)).toBeCloseTo(0.3, 4);
    expect(between(solved.wrist, solved.elbow)).toBeCloseTo(0.4, 4);
  });

  it("extends straight toward a target past the arm", () => {
    const solved = solveTwoBone(0.3, 0.4, [0, -2, 0]);
    expect(solved.wrist).toEqual([0, -0.7, 0]);
    expect(solved.elbow).toEqual([0, -0.3, 0]);
    expect(span(solved.wrist)).toBeCloseTo(0.7, 4);
  });

  it("folds to the minimum reach when the target is inside the arm", () => {
    const solved = solveTwoBone(0.5, 0.2, [0, -0.1, 0]);
    expect(solved.wrist).toEqual([0, -0.3, 0]);
    expect(solved.elbow).toEqual([0, -0.5, 0]);
    expect(between(solved.wrist, solved.elbow)).toBeCloseTo(0.2, 4);
  });
});
