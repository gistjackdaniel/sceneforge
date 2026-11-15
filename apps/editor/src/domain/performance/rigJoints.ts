import { SMPLX_PART_JOINT, rigPartSchema, type RigPart } from "../worlds/sceneState";

/**
 * SMPL-X joint name for a rig part.
 * The string is `SMPLX_PART_JOINT` (`left_wrist`, `right_wrist`, …), not a second enum.
 * Body joints that are not rig parts stay on the authoring handle names.
 */
export const smplxJointForRigPart = (part: RigPart): string => SMPLX_PART_JOINT[part];

/** Rig part for a canonical SMPL-X joint name, when that joint is a rig part. */
export const rigPartForSmplxJoint = (joint: string): RigPart | undefined => {
  const part = rigPartSchema.options.find((candidate) => SMPLX_PART_JOINT[candidate] === joint);
  if (!part) return undefined;
  const parsed = rigPartSchema.safeParse(part);
  return parsed.success ? parsed.data : undefined;
};
