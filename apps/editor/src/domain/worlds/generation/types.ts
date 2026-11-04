import { z } from "zod";
import type { WorldAsset } from "../types";
import type { ConditionType, ModelCondition } from "../../rendering/request";

export type WorldGenerationRequestKind = "text_to_world" | "video_to_world";

export interface WorldGenerationRequest {
  /** Unique id for tracking within the World Generation lane. */
  requestId: string;
  /** Adapter kind. */
  kind: WorldGenerationRequestKind;
  /**
   * Target WorldAsset to be produced or updated by generation.
   * This must reference a WorldAsset.id and never embed a parallel manifest.
   */
  targetWorldAssetId: WorldAsset["id"];
  /**
   * Optional base WorldAsset used as a reference/starting point.
   * When present, must reference a WorldAsset.id.
   */
  baseWorldAssetId?: WorldAsset["id"];
  /**
   * Ordered, model-agnostic conditions for generation (text, images, world_reference, camera, etc.)
   * Reuses the existing ModelCondition type to remain compatible with RenderRequest conditions.
   */
  conditions: ModelCondition[];
  /** Optional random seed for determinism. */
  seed?: number;
  /** Free-form backend options for future connectors; carried opaquely. */
  backendOptions?: Record<string, unknown>;
  /** Lane metadata for analytics/debugging; no behavioral meaning. */
  metadata?: Record<string, unknown>;
}

/**
 * Kept in lockstep with `ConditionType`. Adding a condition type without updating
 * this list fails compilation via `assertConditionTypesInSync`.
 */
export const modelConditionTypes = [
  "text",
  "image",
  "video",
  "depth",
  "pose",
  "mask",
  "camera",
  "motion",
  "world_reference",
] as const satisfies readonly ConditionType[];

const assertConditionTypesInSync = <T extends never>(): void => {
  void (null as T);
};

assertConditionTypesInSync<Exclude<ConditionType, (typeof modelConditionTypes)[number]>>();
assertConditionTypesInSync<Exclude<(typeof modelConditionTypes)[number], ConditionType>>();

// Shape follows ModelCondition. WorldAsset itself is not re-declared here.
export const modelConditionSchema: z.ZodType<ModelCondition> = z.object({
  id: z.string(),
  type: z.enum(modelConditionTypes),
  assetId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().optional(),
});

export const worldGenerationRequestSchema = z.object({
  requestId: z.string().min(1),
  kind: z.union([z.literal("text_to_world"), z.literal("video_to_world")]),
  targetWorldAssetId: z.string().min(1),
  baseWorldAssetId: z.string().min(1).optional(),
  conditions: z.array(modelConditionSchema),
  seed: z.number().nonnegative().optional(),
  backendOptions: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorldGenerationRequestDto = z.infer<typeof worldGenerationRequestSchema>;

let requestSequence = 0;

/**
 * Id for one lane request. A counter plus `randomUUID` keeps two calls in the
 * same millisecond distinct. This id is not a WorldAsset id.
 */
export const createWorldGenerationRequestId = (): string => {
  requestSequence += 1;
  const unique = globalThis.crypto?.randomUUID?.() ?? requestSequence.toString(36);
  return `wreq-${Date.now().toString(36)}-${requestSequence.toString(36)}-${unique}`;
};

