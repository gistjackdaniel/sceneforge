import type { GeneratedMotionProvenance, MotionProvenance, ObjectPoseKey, PosedSubject, Shot, Subject } from "../shot";
import type { ActorPoseSequence } from "./motionModel";
import { GENERATED_MOTION_SOURCE } from "./objectStream";
import { QuatMath, SmplxSkeleton } from "./pose";

/**
 * Shot-record pose is one transform per integer frame (`ObjectPoseKey`).
 * `rotationEuler` is intrinsic XYZ radians, the Three.js `Object3D.rotation` default.
 * The pelvis is that transform. The 55-joint curve stays on the pipeline scene.
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
