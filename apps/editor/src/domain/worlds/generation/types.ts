import { z } from "zod";
import type { WorldAsset } from "../types";
import type { ModelCondition } from "../../rendering/request";

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

// Minimal Zod schema for ModelCondition without re-defining WorldAsset schemas.
export const modelConditionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "text",
    "image",
    "video",
    "depth",
    "pose",
    "mask",
    "camera",
    "motion",
    "world_reference",
  ] as const),
  assetId: z.string().optional(),
  // Payload is connector/model-specific; keep permissive but bounded to plain objects
  payload: z.record(z.any()).optional(),
  weight: z.number().optional(),
});

export const worldGenerationRequestSchema = z.object({
  requestId: z.string().min(1),
  kind: z.union([z.literal("text_to_world"), z.literal("video_to_world")]),
  targetWorldAssetId: z.string().min(1),
  baseWorldAssetId: z.string().min(1).optional(),
  conditions: z.array(modelConditionSchema),
  seed: z.number().nonnegative().optional(),
  backendOptions: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export type WorldGenerationRequestDto = z.infer<typeof worldGenerationRequestSchema>;

