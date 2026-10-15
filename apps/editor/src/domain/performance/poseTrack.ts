import { z } from "zod";
import { axisAngleToQuaternion, quaternionToAxisAngle, slerpQuaternion } from "../utils/quaternion";

// SMPL-X pose vector shapes (axis-angle radians, world Y-up meters)
export const smplxPoseSchema = z.object({
  global_orient: z.array(z.number()).length(3),
  transl: z.array(z.number()).length(3),
  body_pose: z.array(z.number()).length(63),
  left_hand_pose: z.array(z.number()).length(45),
  right_hand_pose: z.array(z.number()).length(45),
  jaw_pose: z.array(z.number()).length(3),
  expression: z.array(z.number()).length(10),
});
export type SmplxPose = z.infer<typeof smplxPoseSchema>;

export const defaultSmplxPose = (): SmplxPose => ({
  global_orient: [0, 0, 0],
  transl: [0, 0, 0],
  body_pose: Array(63).fill(0),
  left_hand_pose: Array(45).fill(0),
  right_hand_pose: Array(45).fill(0),
  jaw_pose: [0, 0, 0],
  expression: Array(10).fill(0),
});

export const smplxKeyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  pose: smplxPoseSchema,
});
export type SmplxKeyframe = z.infer<typeof smplxKeyframeSchema>;

export const smplxTrackSchema = z.object({
  actorElementId: z.string().min(1),
  interpolation: z.enum(["slerp", "hold"]).default("slerp"),
  keyframes: z.array(smplxKeyframeSchema),
});
export type SmplxTrack = z.infer<typeof smplxTrackSchema>;

export const upsertSmplxKeyframe = (track: SmplxTrack, key: SmplxKeyframe): SmplxTrack => {
  const next = [...track.keyframes.filter((k) => k.frame !== key.frame), smplxKeyframeSchema.parse(key)].sort(
    (a, b) => a.frame - b.frame,
  );
  return { ...track, keyframes: next };
};

export const removeSmplxKeyframe = (track: SmplxTrack, frame: number): SmplxTrack => ({
  ...track,
  keyframes: track.keyframes.filter((k) => k.frame !== frame),
});

const slerpAA = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => {
  const qa = axisAngleToQuaternion(a);
  const qb = axisAngleToQuaternion(b);
  return quaternionToAxisAngle(slerpQuaternion(qa, qb, t));
};

/** Interpolate a SMPL-X pose at a given frame. */
export const sampleSmplxTrack = (track: SmplxTrack | undefined, frame: number): SmplxPose | undefined => {
  const keys = track?.keyframes.slice().sort((l, r) => l.frame - r.frame);
  if (!keys?.length) return undefined;
  const after = keys.findIndex((k) => k.frame > frame);
  if (after === 0) return keys[0].pose;
  if (after < 0) return keys[keys.length - 1].pose;
  const left = keys[after - 1];
  const right = keys[after];
  if (track?.interpolation === "hold") return left.pose;
  const span = right.frame - left.frame;
  const t = span > 0 ? (frame - left.frame) / span : 0;
  const out: SmplxPose = {
    global_orient: slerpAA(left.pose.global_orient as [number, number, number], right.pose.global_orient as [number, number, number], t),
    transl: [
      left.pose.transl[0] + (right.pose.transl[0] - left.pose.transl[0]) * t,
      left.pose.transl[1] + (right.pose.transl[1] - left.pose.transl[1]) * t,
      left.pose.transl[2] + (right.pose.transl[2] - left.pose.transl[2]) * t,
    ],
    body_pose: left.pose.body_pose.map((_, i) =>
      slerpAA(
        [left.pose.body_pose[i - (i % 3)], left.pose.body_pose[i - (i % 3) + 1], left.pose.body_pose[i - (i % 3) + 2]] as [number, number, number],
        [right.pose.body_pose[i - (i % 3)], right.pose.body_pose[i - (i % 3) + 1], right.pose.body_pose[i - (i % 3) + 2]] as [number, number, number],
        t,
      )[i % 3],
    ),
    left_hand_pose: left.pose.left_hand_pose.map((_, i) =>
      slerpAA(
        [left.pose.left_hand_pose[i - (i % 3)], left.pose.left_hand_pose[i - (i % 3) + 1], left.pose.left_hand_pose[i - (i % 3) + 2]] as [number, number, number],
        [right.pose.left_hand_pose[i - (i % 3)], right.pose.left_hand_pose[i - (i % 3) + 1], right.pose.left_hand_pose[i - (i % 3) + 2]] as [number, number, number],
        t,
      )[i % 3],
    ),
    right_hand_pose: left.pose.right_hand_pose.map((_, i) =>
      slerpAA(
        [left.pose.right_hand_pose[i - (i % 3)], left.pose.right_hand_pose[i - (i % 3) + 1], left.pose.right_hand_pose[i - (i % 3) + 2]] as [number, number, number],
        [right.pose.right_hand_pose[i - (i % 3)], right.pose.right_hand_pose[i - (i % 3) + 1], right.pose.right_hand_pose[i - (i % 3) + 2]] as [number, number, number],
        t,
      )[i % 3],
    ),
    jaw_pose: slerpAA(left.pose.jaw_pose as [number, number, number], right.pose.jaw_pose as [number, number, number], t),
    expression: left.pose.expression.map((lv, i) => lv + (right.pose.expression[i] - lv) * t),
  };
  // Zod-validate to ensure correct sizes
  return smplxPoseSchema.parse(out);
};

