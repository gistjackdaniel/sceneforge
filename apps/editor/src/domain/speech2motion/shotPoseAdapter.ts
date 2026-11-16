import type { ObjectPoseKey, PosedSubject, Shot, Subject } from "../shot";
import type { ActorPoseSequence } from "./motionModel";
import { QuatMath, SmplxSkeleton } from "./pose";

/**
 * Shot-record pose is one transform per integer frame (`ObjectPoseKey`).
 * `rotationEuler` is intrinsic XYZ radians, the Three.js `Object3D.rotation` default.
 * The pelvis is that transform. The 55-joint curve stays on the pipeline scene.
 *
 * TODO: `MotionProvenance` is only `{ kind: "keyed" }`. The pipeline pose sequence
 * carries `source: "generated"` beside these keys. Do not write `text_prompt` into the shot.
 */
export class ShotPoseAdapter {
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

  static withKeys(subject: PosedSubject, keys: readonly ObjectPoseKey[]): Subject | undefined {
    const tuple = ShotPoseAdapter.nonEmpty(keys);
    if (!tuple) return undefined;
    return {
      ...subject,
      motion: {
        channel: "explicit",
        interpolation: "linear",
        keys: tuple,
        provenance: { kind: "keyed" },
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
