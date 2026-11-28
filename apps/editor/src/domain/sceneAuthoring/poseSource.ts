import { GENERATED_POSE_SOURCE, type RigPart } from "./contract";
import { resolvedRigPart, type EffectorChannel } from "./contacts";
import type { ContactEvent } from "./contract";
import { quatFromAxisAngle, quatMul, quatSlerp, type Mat4, type Quat } from "./math";

/**
 * One integer frame of an actor pelvis in the shot pose representation.
 * `rotationEuler` is intrinsic XYZ radians. This is not a second pose schema.
 */
export interface ShotPoseFrame {
  frame: number;
  position: readonly [number, number, number];
  rotationEuler: readonly [number, number, number];
  scale: readonly [number, number, number];
  source: typeof GENERATED_POSE_SOURCE;
}

export interface ObjectPoseFrame {
  /** Integer frame on `Shot.time`. Seconds are `t / Shot.time.fps`. */
  t: number;
  T_world_obj: Mat4;
}

/** Dense object motion. One matrix per shot frame. `source` is `generated`. */
export interface ObjectPoseStream {
  objectId: string;
  subjectId: string;
  source: typeof GENERATED_POSE_SOURCE;
  frames: readonly ObjectPoseFrame[];
}

/**
 * Replaceable playback pose. Video can return the same subject ids later.
 * The fixture does not import the Video lane. Subject ids are opaque strings.
 */
export interface PoseSequenceSource {
  readonly source: typeof GENERATED_POSE_SOURCE;
  /** Pelvis at an integer shot-local frame. Undefined when this source has no actor. */
  actorPose(subjectId: string, frame: number): ShotPoseFrame | undefined;
  /** Dense `T_world_obj`. The cup source returns every frame in the shot. */
  objectStream(subjectId: string): ObjectPoseStream | undefined;
  /** Proxy joint locals for the viewport. A later SMPL-X sequence can replace these. */
  joints(subjectId: string, frame: number): Readonly<Record<string, Quat>>;
}

export interface RotationKey {
  frame: number;
  rotation: Quat;
}

export interface AuthoredPoseChannel extends EffectorChannel {
  id: string;
  joints: Record<string, RotationKey[]>;
}

const sidePrefix = (part: RigPart): "left" | "right" | undefined => {
  if (part.startsWith("left_")) return "left";
  if (part.startsWith("right_")) return "right";
  return undefined;
};

/** Preview stand-in so the other hand still reaches the partner. Video IK replaces this. */
const crossBodySwing = (rotation: Quat, from: RigPart, to: RigPart): Quat => {
  if (from === to) return rotation;
  const yaw = to === "right_hand" ? -1.15 : to === "left_hand" ? 1.15 : 0;
  if (yaw === 0) return rotation;
  return quatMul(quatFromAxisAngle([0, 1, 0], yaw), rotation);
};

const retargetJointName = (jointName: string, from: RigPart, to: RigPart): string => {
  if (from === to) return jointName;
  const fromSide = sidePrefix(from);
  const toSide = sidePrefix(to);
  if (!fromSide || !toSide) return jointName;
  const prefix = `${fromSide}_`;
  if (!jointName.startsWith(prefix)) return jointName;
  return `${toSide}_${jointName.slice(prefix.length)}`;
};

const sampleKeys = <T extends { frame: number }>(keys: readonly T[], frame: number): { left: T; right: T; t: number } | undefined => {
  if (keys.length === 0) return undefined;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return { left: sorted[0], right: sorted[0], t: 0 };
  const last = sorted[sorted.length - 1];
  if (frame >= last.frame) return { left: last, right: last, t: 0 };
  let index = 1;
  while (index < sorted.length && sorted[index].frame < frame) index += 1;
  const right = sorted[index];
  const left = sorted[index - 1];
  const span = right.frame - left.frame;
  return { left, right, t: span > 0 ? (frame - left.frame) / span : 0 };
};

const channelCovers = (keys: readonly RotationKey[], frame: number): boolean => {
  if (keys.length === 0) return false;
  const frames = keys.map((key) => key.frame);
  return frame >= Math.min(...frames) && frame <= Math.max(...frames);
};

const sampleRotation = (keys: readonly RotationKey[], frame: number): Quat | undefined => {
  if (!channelCovers(keys, frame)) return undefined;
  const hit = sampleKeys(keys, frame);
  if (!hit) return undefined;
  return quatSlerp(hit.left.rotation, hit.right.rotation, hit.t);
};

/** Joint locals for authored channels. Contacts choose the effector. Channels are not rewritten. */
export const poseSourceFromChannels = (
  channels: readonly AuthoredPoseChannel[],
  contacts: readonly ContactEvent[],
): Pick<PoseSequenceSource, "joints"> => ({
  joints(subjectId, frame) {
    const frameIndex = Math.floor(frame);
    const joints: Record<string, Quat> = {};
    for (const channel of channels) {
      if (channel.subjectId !== subjectId) continue;
      const targetPart = resolvedRigPart(channel, contacts);
      for (const [jointName, keys] of Object.entries(channel.joints)) {
        const rotation = sampleRotation(keys, frameIndex);
        if (!rotation) continue;
        const jointNameOnTarget = retargetJointName(jointName, channel.rigPart, targetPart);
        const swung = jointName.endsWith("shoulder") ? crossBodySwing(rotation, channel.rigPart, targetPart) : rotation;
        joints[jointNameOnTarget] = swung;
      }
    }
    return joints;
  },
});
