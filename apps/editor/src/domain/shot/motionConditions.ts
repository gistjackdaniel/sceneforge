import { z } from "zod";
import { somaClipReferenceSchema } from "../sceneAuthoring/somaMotion";
import type { Shot } from "./types";

export const motionSourceSchema = somaClipReferenceSchema;

export const motionSpanSchema = z.object({
  subjectId: z.string().min(1),
  sourceId: motionSourceSchema.shape.sha256,
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
}).refine((span) => span.endFrame > span.startFrame, "Motion needs a non-empty frame range.");

const motionTargetSchema = z.object({
  subjectId: z.string().min(1),
  instanceId: z.string().min(1),
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const motionConditionGraphSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z.array(motionTargetSchema),
  sources: z.record(motionSourceSchema.shape.sha256, motionSourceSchema),
  spans: z.array(motionSpanSchema),
});

export type MotionSource = z.infer<typeof motionSourceSchema>;
export type MotionSpan = z.infer<typeof motionSpanSchema>;
export type MotionConditionGraph = z.infer<typeof motionConditionGraphSchema>;

export const motionEditSchema = z.object({
  subjectId: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  source: motionSourceSchema,
});
export type MotionEdit = z.infer<typeof motionEditSchema>;

/** Read the active revision without copying source clips or inactive revisions into the model payload. */
export const motionConditionGraph = (shot: Shot): MotionConditionGraph | undefined => {
  const revision = shot.revisions?.find((item) => item.id === shot.headRevisionId);
  const storedSources = shot.motionSources;
  if (!revision?.motionSpans?.length || !storedSources) return undefined;
  const targets: MotionConditionGraph["targets"] = [];
  const sourceIds = new Set<string>();
  const targetIds = new Set<string>();
  const spans = revision.motionSpans.flatMap((span) => {
    const actor = shot.subjects.find((subject) => subject.id === span.subjectId);
    if (actor?.kind !== "human" || !actor.instanceId || !actor.assetRef || !storedSources[span.sourceId]) return [];
    const endFrame = Math.min(shot.time.durationFrames, span.endFrame);
    if (endFrame <= span.startFrame) return [];
    sourceIds.add(span.sourceId);
    if (!targetIds.has(span.subjectId)) {
      targetIds.add(span.subjectId);
      targets.push({ subjectId: actor.id, instanceId: actor.instanceId, ...actor.assetRef });
    }
    return [{ ...span, endFrame }];
  });
  if (spans.length === 0) return undefined;
  const sources = Object.fromEntries([...sourceIds].map((id) => [id, storedSources[id]]));
  return { schemaVersion: 1, targets, sources, spans };
};

/** Later keys in the revision replace earlier keys only where their actor and frame range match. */
export const motionSpanAt = (graph: MotionConditionGraph | undefined, subjectId: string, frame: number): MotionSpan | undefined => {
  const spans = graph?.spans ?? [];
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    if (span.subjectId === subjectId && frame >= span.startFrame && frame < span.endFrame) return span;
  }
  return undefined;
};
