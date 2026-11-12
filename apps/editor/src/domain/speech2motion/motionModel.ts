import { GENERATED_MOTION_SOURCE, type MotionSource } from "./objectStream";
import { PoseResample, QuatMath, SmplxSkeleton, TwoBoneIk, Vec, type JointPose, type PoseFrame, type Quat, type Vec3 } from "./pose";
import type { RigPart } from "./actionGraph";

/** OmniMotion-X and PASPA are not public. The stub is the only model in this phase. */
export const MODEL_FPS = 30;

export interface MotionTrajectoryPoint {
  frame: number;
  position: Vec3;
  heading?: number;
}

export interface MotionEventInput {
  actorId: string;
  startFrame: number;
  endFrame: number;
  text?: string;
  trajectory?: readonly MotionTrajectoryPoint[];
}

export interface MotionModelRequest {
  /** `Shot.time.fps`. Output frames are integers on this clock. */
  shotFps: number;
  frameCount: number;
  actors: readonly { actorId: string }[];
  events: readonly MotionEventInput[];
}

export interface ActorPoseSequence {
  actorId: string;
  /** Always {@link GENERATED_MOTION_SOURCE}. Not `text_prompt`. */
  source: MotionSource;
  frames: readonly PoseFrame[];
}

export interface MotionModelAdapter {
  infer(request: MotionModelRequest): readonly ActorPoseSequence[];
}

const REST_PELVIS_Y = 0.95;
const ACTOR_SPACING = 1;

/**
 * Deterministic stand-in for a text-and-trajectory motion model.
 * Samples at {@link MODEL_FPS}, then resamples onto `Shot.fps`.
 * Trajectory XZ and heading drive the pelvis. Trajectory Y is a hand target, not a second root height.
 */
export class StubMotionModel implements MotionModelAdapter {
  static readonly modelFps = MODEL_FPS;

  static infer(request: MotionModelRequest): readonly ActorPoseSequence[] {
    return new StubMotionModel().infer(request);
  }

  infer(request: MotionModelRequest): readonly ActorPoseSequence[] {
    const times = PoseResample.modelTimes(request.shotFps, request.frameCount, StubMotionModel.modelFps);
    return request.actors.map((actor, index) => {
      const samples = times.map((time) => ({
        time,
        joints: this.poseAt(actor.actorId, index, time, request),
      }));
      return {
        actorId: actor.actorId,
        source: GENERATED_MOTION_SOURCE,
        frames: PoseResample.toShotFrames(samples, request.shotFps, request.frameCount),
      };
    });
  }

  private poseAt(actorId: string, index: number, time: number, request: MotionModelRequest): JointPose[] {
    const shotFrame = Math.round(time * request.shotFps);
    const active = request.events
      .filter((event) => event.actorId === actorId && event.startFrame <= shotFrame && shotFrame <= event.endFrame)
      .sort((left, right) => left.startFrame - right.startFrame);
    const guide = StubMotionModel.trajectoryAt(active, request.shotFps, time);
    const pelvis: Vec3 = guide
      ? [guide.position[0], REST_PELVIS_Y, guide.position[2]]
      : [index * ACTOR_SPACING, REST_PELVIS_Y, 0];
    const yaw = guide?.heading ?? 0;
    let joints = SmplxSkeleton.restPose(pelvis, yaw);
    const twist = StubMotionModel.textTwist(active.map((event) => event.text ?? "").join("\n"));
    joints = joints.map((joint, jointId) =>
      jointId === SmplxSkeleton.pelvisIndex ? joint : { ...joint, rotation: QuatMath.mul(twist, joint.rotation) },
    );
    if (guide) {
      const limb = SmplxSkeleton.limb(StubMotionModel.handForText(active.map((event) => event.text ?? "").join("\n")));
      if (limb) joints = TwoBoneIk.solve(joints, limb, guide.position);
    }
    return joints;
  }

  private static trajectoryAt(
    events: readonly MotionEventInput[],
    shotFps: number,
    time: number,
  ): { position: Vec3; heading: number } | undefined {
    const points = events.flatMap((event) => event.trajectory ?? []);
    if (points.length === 0) return undefined;
    const ordered = [...points].sort((left, right) => left.frame - right.frame);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const sample = (point: MotionTrajectoryPoint) => ({
      position: point.position,
      heading: point.heading ?? 0,
    });
    if (time <= first.frame / shotFps) return sample(first);
    if (time >= last.frame / shotFps) return sample(last);
    const after = ordered.findIndex((point) => point.frame / shotFps > time);
    const right = ordered[after]!;
    const left = ordered[after - 1]!;
    const span = right.frame / shotFps - left.frame / shotFps;
    const amount = span > 0 ? (time - left.frame / shotFps) / span : 0;
    return {
      position: Vec.lerp(left.position, right.position, amount),
      heading: (left.heading ?? 0) + ((right.heading ?? 0) - (left.heading ?? 0)) * amount,
    };
  }

  /** A small yaw on non-root joints so the text is part of the pose without moving the pelvis. */
  private static textTwist(text: string): Quat {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const angle = (((hash >>> 0) % 1000) / 1000) * 0.15 - 0.075;
    return QuatMath.fromAxisAngle([0, 1, 0], angle);
  }

  private static handForText(text: string): RigPart {
    const normalized = text.toLowerCase();
    if (normalized.includes("왼손") || normalized.includes("left")) return "left_hand";
    return "right_hand";
  }
}
