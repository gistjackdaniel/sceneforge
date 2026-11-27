import { eulerToQuaternion } from "../shot/eulerAdapter";
import { sampleSubjectPose } from "../shot/queries";
import { motionSpanAt, type MotionConditionGraph } from "../shot/motionConditions";
import type { PosedSubject, Shot, Transform } from "../shot/types";
import { addVec3, asQuat, asVec3, quatFromAxisAngle, quatMul, quatRotate, type Vec3 } from "./math";
import { sampleSomaMotion, somaHeading, type SomaFrame, type SomaMotion } from "./somaMotion";

/** Place one sample of a clip relative to the actor's pose: the clip's first frame lands on the actor, facing its way. */
export const placeSomaSample = (placement: Transform, motion: SomaMotion, sample: SomaFrame) => {
  const rotation = asQuat(eulerToQuaternion(placement.rotationEuler));
  const first = motion.frames[0];
  const heading = somaHeading(first);
  const offset: Vec3 = [
    sample.rootPosition[0] - first.rootPosition[0],
    sample.rootPosition[1] - first.rootPosition[1],
    sample.rootPosition[2] - first.rootPosition[2],
  ];
  const relative = quatRotate(quatFromAxisAngle([0, 1, 0], -heading), offset);
  return {
    position: addVec3(asVec3(placement.position), quatRotate(rotation, relative)),
    rotation: quatMul(rotation, quatFromAxisAngle([0, 1, 0], somaHeading(sample) - heading)),
    scale: placement.scale,
    source: { motion, sample },
  };
};

/** Place the clip relative to the authored actor pose, keeping the raw source immutable. */
export const sampleTimelineMotion = (
  shot: Shot, actor: PosedSubject, frame: number, graph: MotionConditionGraph | undefined,
  clips: ReadonlyMap<string, SomaMotion>,
) => {
  const placement = sampleSubjectPose(actor, frame);
  const span = motionSpanAt(graph, actor.id, frame);
  const motion = span && clips.get(span.sourceId);
  if (!span || !motion) {
    return { position: asVec3(placement.position), rotation: asQuat(eulerToQuaternion(placement.rotationEuler)), scale: placement.scale, source: undefined };
  }
  return placeSomaSample(placement, motion, sampleSomaMotion(motion, (frame - span.startFrame) / shot.time.fps));
};
