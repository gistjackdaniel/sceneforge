import { worldGenerationRequestSchema, type WorldGenerationRequest } from "./types";
import { isWorldGenLaneEnabled } from "./featureFlags";
import type { ModelCondition } from "../../rendering/request";

export interface TextWorldAdapterInput {
  prompt: string;
  /** Target world id to be created or updated by generation. */
  targetWorldAssetId: string;
  /** Optional reference world id (existing). */
  baseWorldAssetId?: string;
  seed?: number;
  /** Opaque backend options (connector selection, params). */
  backendOptions?: Record<string, unknown>;
  /** Extra metadata for analytics/debug; ignored by connectors. */
  metadata?: Record<string, unknown>;
}

/**
 * Adapter: text prompt -> WorldGenerationRequest
 * - Validates shape via Zod
 * - References WorldAsset by id only (no embedded manifest)
 * - Gated by the World Generation lane feature flag (OFF by default)
 */
export const buildTextWorldGenerationRequest = (input: TextWorldAdapterInput): WorldGenerationRequest => {
  if (!isWorldGenLaneEnabled()) {
    throw new Error("World Generation lane is disabled (set VITE_FEATURE_WORLD_GEN_LANE=1 to enable).");
  }
  const conditions: ModelCondition[] = [];
  const prompt = String(input.prompt ?? "").trim();
  if (prompt.length > 0) {
    conditions.push({ id: "prompt", type: "text", payload: { text: prompt } });
  }
  const request: WorldGenerationRequest = {
    requestId: `wreq-${Date.now().toString(36)}`,
    kind: "text_to_world",
    targetWorldAssetId: input.targetWorldAssetId,
    baseWorldAssetId: input.baseWorldAssetId,
    conditions,
    seed: input.seed,
    backendOptions: input.backendOptions,
    metadata: input.metadata,
  };
  // Validate and return a cleaned plain object (no class instances)
  const parsed = worldGenerationRequestSchema.parse(request);
  return parsed as WorldGenerationRequest;
};

