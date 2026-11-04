import { describe, it, expect } from "vitest";
import { POSE_PRESETS, posePreset, applyHandPreset } from "./presets";

describe("SMPL-X pose presets", () => {
  it("lists expected presets", () => {
    expect(POSE_PRESETS.map((p) => p.id)).toEqual(["t_pose", "a_pose", "idle", "walk_contact", "sit", "point"]);
  });
  it("returns valid vector sizes", () => {
    const p = posePreset("t_pose");
    expect(p.body_pose.length).toBe(63);
    expect(p.left_hand_pose.length).toBe(45);
    expect(p.right_hand_pose.length).toBe(45);
    expect(p.expression.length).toBe(10);
  });
  it("applies hand presets coarsely", () => {
    const start = posePreset("idle");
    const pointed = applyHandPreset(start, "right", "point");
    expect(pointed.right_hand_pose.reduce((a, b) => a + b, 0)).toBeGreaterThan(start.right_hand_pose.reduce((a, b) => a + b, 0));
  });
});

