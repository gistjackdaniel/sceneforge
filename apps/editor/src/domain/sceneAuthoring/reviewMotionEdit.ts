import { hashValue } from "../graph/cacheKey";
import { motionConditionGraph } from "../shot/motionConditions";
import { selectedTake } from "../shot/queries";
import type { Shot } from "../shot/types";
import { resolveShotWorldRevision } from "../worlds/importedShotWorld";
import type { WorldAsset } from "../worlds/types";
import { PHASE1_ACTORS } from "./phase1Demo";
import { sampleTimelineMotion } from "./sampleTimelineMotion";
import type { SomaMotion } from "./somaMotion";

/** Capture the source take, room revision and both original and evaluated actor root data. */
export const reviewMotionState = (shot: Shot, world: WorldAsset | undefined, clips: ReadonlyMap<string, SomaMotion>) => {
  const graph = motionConditionGraph(shot);
  const roots = (subjectId: string) => {
    const actor = shot.subjects.find((subject) => subject.id === subjectId);
    if (actor?.kind !== "human") return undefined;
    const spans = graph?.spans.filter((span) => span.subjectId === subjectId) ?? [];
    return {
      original: spans.map((span) => ({ span, raw: clips.get(span.sourceId)?.frames.map(({ rootPosition, rootRotation, rootHeading }) => ({ rootPosition, rootRotation, rootHeading })) })),
      evaluated: Array.from({ length: shot.time.durationFrames }, (_, frame) => {
        const { position, rotation, scale } = sampleTimelineMotion(shot, actor, frame, graph, clips);
        return { frame, position, rotation, scale };
      }),
    };
  };
  const b = shot.subjects.find((subject) => subject.id === PHASE1_ACTORS.b);
  const bTrack = b?.kind === "human" ? Array.from({ length: shot.time.durationFrames }, (_, frame) =>
    sampleTimelineMotion(shot, b, frame, graph, clips)) : [];
  return {
    shotId: shot.id,
    revisionId: shot.headRevisionId,
    time: shot.time,
    camera: { take: selectedTake(shot), lens: shot.camera.lens, interpolation: shot.camera.interpolation },
    background: {
      environment: shot.environment,
      revision: shot.environment?.revisionId ? resolveShotWorldRevision(world, shot.environment.revisionId) : undefined,
    },
    actorA: roots(PHASE1_ACTORS.a),
    actorB: {
      spans: graph?.spans.filter((span) => span.subjectId === PHASE1_ACTORS.b),
      frame45: bTrack[45]?.source?.sample,
      evaluations: bTrack.map(({ position, rotation, source }) => hashValue({ position, rotation, joints: source?.sample.localRotations })),
    },
    graph,
  };
};

export type MotionReviewState = ReturnType<typeof reviewMotionState>;

export const compareMotionEdit = (before: MotionReviewState, after: MotionReviewState) => {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return {
    camera: Boolean(before.camera.take && after.camera.take && same(before.camera, after.camera)),
    background: Boolean(before.background.revision && after.background.revision && same(before.background, after.background)),
    actorARoot: Boolean(before.actorA?.original.length && after.actorA?.original.length && same(before.actorA, after.actorA)),
    actorBChanged: Boolean(before.actorB.evaluations.length && after.actorB.evaluations.length && !same(before.actorB.evaluations, after.actorB.evaluations)),
  };
};
