import { describe, expect, it } from "vitest";
import { SMPLX_PART_JOINT, rigPartSchema } from "../worlds/sceneState";
import { rigPartForSmplxJoint, smplxJointForRigPart } from "./rigJoints";

describe("SMPL-X joint names for rig parts", () => {
  it("validates every mapped rig part with rigPartSchema", () => {
    for (const part of rigPartSchema.options) {
      const joint = smplxJointForRigPart(part);
      expect(joint).toBe(SMPLX_PART_JOINT[part]);
      const mapped = rigPartForSmplxJoint(joint);
      expect(rigPartSchema.safeParse(mapped).success).toBe(true);
      expect(mapped).toBe(part);
    }
    expect(smplxJointForRigPart("right_hand")).toBe("right_wrist");
    expect(smplxJointForRigPart("left_hand")).toBe("left_wrist");
    expect(rigPartForSmplxJoint("right_wrist")).toBe("right_hand");
    expect(rigPartForSmplxJoint("left_wrist")).toBe("left_hand");
  });
});
