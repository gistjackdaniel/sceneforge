import type { SmplxPose } from "./poseTrack";
import { defaultSmplxPose } from "./poseTrack";

export type PosePresetId = "t_pose" | "a_pose" | "idle" | "walk_contact" | "sit" | "point";

/** Coarse whole-hand presets. */
export type HandPresetId = "open" | "fist" | "point" | "relaxed";

const copy = (pose: SmplxPose): SmplxPose => ({
  global_orient: [...pose.global_orient],
  transl: [...pose.transl],
  body_pose: [...pose.body_pose],
  left_hand_pose: [...pose.left_hand_pose],
  right_hand_pose: [...pose.right_hand_pose],
  jaw_pose: [...pose.jaw_pose],
  expression: [...pose.expression],
});

/** Approximate SMPL-X default A-pose (slightly down arms). */
const buildAPose = (): SmplxPose => {
  const pose = defaultSmplxPose();
  // Arms 30° down from T
  const deg = (d: number) => (d * Math.PI) / 180;
  // Shoulder (rough indices: first two body joints after root for arms vary by model; we use common order)
  // We approximate by pitching upper arms slightly down around Z axis.
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  // Indices are coarse; keep zeroed if mapping differs in downstream.
  setBodyTriplet(15, [0, 0, -deg(30)]); // left upper arm approx
  setBodyTriplet(18, [0, 0, deg(30)]); // right upper arm approx
  return pose;
};

/** T-pose: arms out horizontally. */
const buildTPose = (): SmplxPose => {
  const pose = defaultSmplxPose();
  const deg = (d: number) => (d * Math.PI) / 180;
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  setBodyTriplet(15, [0, 0, -deg(90)]); // left upper arm lift
  setBodyTriplet(18, [0, 0, deg(90)]); // right upper arm lift
  return pose;
};

/** Idle: subtle bend in knees, lowered arms. */
const buildIdle = (): SmplxPose => {
  const pose = buildAPose();
  const deg = (d: number) => (d * Math.PI) / 180;
  // Knees slight bend (approx indices near lower legs)
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  setBodyTriplet(36, [deg(8), 0, 0]); // left knee pitch
  setBodyTriplet(45, [deg(8), 0, 0]); // right knee pitch
  return pose;
};

/** Walk contact: one foot forward, opposite arm forward. */
const buildWalkContact = (): SmplxPose => {
  const pose = buildIdle();
  const deg = (d: number) => (d * Math.PI) / 180;
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  // Hips small translation forward handled by transl during animation; keep transl at 0 for preset
  // Legs stride
  setBodyTriplet(33, [deg(-12), 0, 0]); // left hip pitch back
  setBodyTriplet(42, [deg(12), 0, 0]); // right hip pitch forward
  // Arms opposite
  setBodyTriplet(15, [0, 0, -deg(20)]); // left upper arm back
  setBodyTriplet(18, [0, 0, deg(20)]); // right upper arm forward
  return pose;
};

/** Sit: hips and knees at ~90°, torso upright. */
const buildSit = (): SmplxPose => {
  const pose = buildIdle();
  const deg = (d: number) => (d * Math.PI) / 180;
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  setBodyTriplet(12, [deg(90), 0, 0]); // lower spine bend forward to keep balance (approx)
  setBodyTriplet(33, [deg(80), 0, 0]); // left hip
  setBodyTriplet(36, [deg(-80), 0, 0]); // left knee
  setBodyTriplet(42, [deg(80), 0, 0]); // right hip
  setBodyTriplet(45, [deg(-80), 0, 0]); // right knee
  return pose;
};

/** Point: right arm straight forward, index-hand preset. */
const buildPoint = (): SmplxPose => {
  const pose = buildIdle();
  const deg = (d: number) => (d * Math.PI) / 180;
  const setBodyTriplet = (indexTriplet: number, aa: [number, number, number]) => {
    pose.body_pose[indexTriplet] = aa[0];
    pose.body_pose[indexTriplet + 1] = aa[1];
    pose.body_pose[indexTriplet + 2] = aa[2];
  };
  setBodyTriplet(18, [0, deg(-10), deg(10)]); // right shoulder slight yaw/roll
  setBodyTriplet(21, [0, 0, 0]); // right elbow straight
  // Hand: coarse pointing (index extended)
  pose.right_hand_pose = pose.right_hand_pose.map((v, i) => {
    // Group fingers by triplets; crudely curl others a bit
    return (i >= 0 && i < 3) || (i >= 3 && i < 6) ? 0 : (i >= 6 && i < 9) ? 0.1 : 0.2;
  });
  return pose;
};

export const applyHandPreset = (pose: SmplxPose, side: "left" | "right", preset: HandPresetId): SmplxPose => {
  const next = copy(pose);
  const fill = (value: number) => Array(45).fill(value);
  if (preset === "open") {
    if (side === "left") next.left_hand_pose = fill(0);
    else next.right_hand_pose = fill(0);
  } else if (preset === "fist") {
    if (side === "left") next.left_hand_pose = fill(0.6);
    else next.right_hand_pose = fill(0.6);
  } else if (preset === "relaxed") {
    if (side === "left") next.left_hand_pose = fill(0.2);
    else next.right_hand_pose = fill(0.2);
  } else {
    // point
    if (side === "left") next.left_hand_pose = next.left_hand_pose.map((_, i) => (i % 15 < 3 ? 0 : 0.25));
    else next.right_hand_pose = next.right_hand_pose.map((_, i) => (i % 15 < 3 ? 0 : 0.25));
  }
  return next;
};

export const posePreset = (id: PosePresetId): SmplxPose => {
  switch (id) {
    case "t_pose":
      return buildTPose();
    case "a_pose":
      return buildAPose();
    case "idle":
      return buildIdle();
    case "walk_contact":
      return buildWalkContact();
    case "sit":
      return buildSit();
    case "point":
      return buildPoint();
    default:
      return defaultSmplxPose();
  }
};

export const POSE_PRESETS: Array<{ id: PosePresetId; label: string }> = [
  { id: "t_pose", label: "T-pose" },
  { id: "a_pose", label: "A-pose" },
  { id: "idle", label: "Standing idle" },
  { id: "walk_contact", label: "Walking · contact" },
  { id: "sit", label: "Sitting" },
  { id: "point", label: "Pointing" },
];

