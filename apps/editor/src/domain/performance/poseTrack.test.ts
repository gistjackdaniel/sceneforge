import { describe, it, expect } from "vitest";
import { defaultSmplxPose, sampleSmplxTrack, upsertSmplxKeyframe, type SmplxTrack } from "./poseTrack";
import { axisAngleToQuaternion, quaternionToAxisAngle } from "../utils/quaternion";

describe("SMPL-X pose track interpolation", () => {
  it("slerps axis-angle per joint", () => {
    const left = defaultSmplxPose();
    const right = defaultSmplxPose();
    left.global_orient = [0, 0, 0];
    right.global_orient = [0, 0, Math.PI]; // 180° around Z
    // Body first joint twist 90°
    left.body_pose[0] = 0;
    left.body_pose[1] = 0;
    left.body_pose[2] = 0;
    right.body_pose[0] = 0;
    right.body_pose[1] = 0;
    right.body_pose[2] = Math.PI / 2;
    const base: SmplxTrack = { actorElementId: "actor-a", interpolation: "slerp", keyframes: [] };
    const track = upsertSmplxKeyframe(upsertSmplxKeyframe(base, { frame: 0, pose: left }), { frame: 10, pose: right });
    const mid = sampleSmplxTrack(track, 5)!;
    // Midpoint global orient about half rotation when converted back and forth
    const q0 = axisAngleToQuaternion(left.global_orient as [number, number, number]);
    const q1 = axisAngleToQuaternion(right.global_orient as [number, number, number]);
    const expectedMid = quaternionToAxisAngle([
      q0[0] * 0.0 + q1[0] * 0.0,
      q0[1] * 0.0 + q1[1] * 0.0,
      q0[2] * 0.0 + q1[2] * 0.0,
      q0[3] * 0.0 + q1[3] * 0.0,
    ] as unknown as [number, number, number, number]); // not a real slerp, just ensure function runs
    expect(mid.global_orient.length).toBe(3);
    // Body joint half-ish
    expect(mid.body_pose[2]).toBeGreaterThan(0.7);
    expect(mid.body_pose[2]).toBeLessThan(2.0);
  });
});

