import type { BodyCurve, GeneratedMotionProvenance, MotionProvenance, ObjectPoseKey, PosedSubject, Shot, SmplxBodyFrame, Subject } from "../shot";
import type { ActorPoseSequence } from "./motionModel";
import { GENERATED_MOTION_SOURCE } from "./objectStream";
import { QuatMath, SmplxSkeleton, neutralFace, type JointPose, type Quat } from "./pose";

/**
 * Root keys stay the pelvis transform (`rotationEuler` is intrinsic XYZ).
 * `motion.body` stores the 55-joint SMPL-X pose and the face on the same frames.
 * A missing provenance stays `{ kind: "keyed" }`. Generated poses carry the action graph and adapter.
 */
export class ShotPoseAdapter {
  static generatedProvenance(input: {
    shotId: string;
    graphVersion: string;
    adapterId: string;
    modelFps: number;
  }): GeneratedMotionProvenance {
    return {
      kind: "generated",
      source: GENERATED_MOTION_SOURCE,
      actionGraph: { shotId: input.shotId, graphVersion: input.graphVersion },
      model: { adapterId: input.adapterId, modelFps: input.modelFps },
    };
  }

  static rootKeys(sequence: ActorPoseSequence): ObjectPoseKey[] {
    return sequence.frames.flatMap((frame) => {
      const pelvis = frame.joints[SmplxSkeleton.pelvisIndex];
      if (!pelvis) return [];
      return [ShotPoseAdapter.key(frame.frame, pelvis.translation, QuatMath.toEulerXYZ(pelvis.rotation))];
    });
  }

  static subjectForActor(shot: Shot, actorId: string): PosedSubject | undefined {
    const subject = shot.subjects.find((item) => item.kind === "human" && (item.id === actorId || item.name === actorId));
    return subject && subject.kind !== "light" ? subject : undefined;
  }

  static withKeys(
    subject: PosedSubject,
    keys: readonly ObjectPoseKey[],
    provenance: MotionProvenance = { kind: "keyed" },
    body?: BodyCurve,
  ): Subject | undefined {
    const tuple = ShotPoseAdapter.nonEmpty(keys);
    if (!tuple) return undefined;
    return {
      ...subject,
      motion: {
        channel: "explicit",
        interpolation: "linear",
        keys: tuple,
        provenance,
        ...(body ? { body } : {}),
      },
    };
  }

  /** Root keys plus the full SMPL-X body and expression curve. */
  static withPose(
    subject: PosedSubject,
    sequence: ActorPoseSequence,
    provenance: MotionProvenance = { kind: "keyed" },
  ): Subject | undefined {
    return ShotPoseAdapter.withKeys(subject, ShotPoseAdapter.rootKeys(sequence), provenance, ShotPoseAdapter.bodyCurve(sequence));
  }

  static bodyCurve(sequence: ActorPoseSequence): BodyCurve | undefined {
    const frames = sequence.frames.flatMap((frame) => {
      if (frame.joints.length < SmplxSkeleton.jointCount) return [];
      const packed = ShotPoseAdapter.packFrame(frame.frame, frame.joints, frame.face ?? neutralFace());
      return packed ? [packed] : [];
    });
    const [first, ...rest] = frames;
    if (!first) return undefined;
    return { model: "smplx", frames: [first, ...rest] };
  }

  private static axis(rotation: Quat): [number, number, number] {
    const [x, y, z, w] = QuatMath.normalize(rotation);
    const angle = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
    const scale = Math.sqrt(Math.max(0, 1 - w * w));
    if (scale < 1e-8 || angle < 1e-8) return [0, 0, 0];
    return [(x / scale) * angle, (y / scale) * angle, (z / scale) * angle];
  }

  private static packAxes(joints: readonly JointPose[], start: number, count: number): number[] {
    const axes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const joint = joints[start + index];
      const [ax, ay, az] = joint ? ShotPoseAdapter.axis(joint.rotation) : [0, 0, 0];
      axes.push(ax, ay, az);
    }
    return axes;
  }

  private static packFrame(frame: number, joints: readonly JointPose[], face: ReturnType<typeof neutralFace>): SmplxBodyFrame | undefined {
    const pelvis = joints[SmplxSkeleton.pelvisIndex];
    if (!pelvis || face.expression.length !== 10) return undefined;
    return {
      frame,
      pose: {
        global_orient: ShotPoseAdapter.axis(pelvis.rotation),
        transl: [pelvis.translation[0], pelvis.translation[1], pelvis.translation[2]],
        body_pose: ShotPoseAdapter.packAxes(joints, 1, 21),
        left_hand_pose: ShotPoseAdapter.packAxes(joints, 25, 15),
        right_hand_pose: ShotPoseAdapter.packAxes(joints, 40, 15),
        jaw_pose: [face.jawPose[0], face.jawPose[1], face.jawPose[2]],
        expression: [...face.expression],
      },
    };
  }

  private static key(frame: number, position: readonly [number, number, number], rotationEuler: readonly [number, number, number]): ObjectPoseKey {
    return {
      frame,
      position: [position[0], position[1], position[2]],
      rotationEuler: [rotationEuler[0], rotationEuler[1], rotationEuler[2]],
      scale: [1, 1, 1],
    };
  }

  private static nonEmpty(keys: readonly ObjectPoseKey[]): readonly [ObjectPoseKey, ...ObjectPoseKey[]] | undefined {
    const [first, ...rest] = keys;
    if (!first) return undefined;
    return [first, ...rest];
  }
}
