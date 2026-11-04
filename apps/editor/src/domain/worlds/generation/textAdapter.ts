import type { ModelCondition } from "../../rendering/request";
import { isWorldGenLaneEnabled } from "./featureFlags";
import { resolveWorldAssetId, type WorldTargetScope } from "./resolveTarget";
import { createWorldGenerationRequestId, worldGenerationRequestSchema, type WorldGenerationRequest } from "./types";

export interface TextWorldAdapterInput extends WorldTargetScope {
  prompt: string;
  /** Name, alias, tag, or an existing WorldAsset.id. */
  targetRef: string;
  /** Optional base world. Same lookup rules as `targetRef`. */
  baseRef?: string;
  seed?: number;
  /** Opaque backend options (connector selection, params). */
  backendOptions?: Record<string, unknown>;
  /** Extra metadata for analytics/debug. Not a world identity. */
  metadata?: Record<string, unknown>;
}

/**
 * Adapter: text prompt -> WorldGenerationRequest.
 *
 * Invalidation: none. Does not write the shot, the world library, or a manifest.
 * Downstream: the returned request addresses existing worlds by `WorldAsset.id` only.
 * Side effects: none. Throws when `VITE_FEATURE_WORLD_GEN_LANE` is off, or when a
 * target cannot be resolved to one `WorldAsset.id` through `TargetResolver`.
 */
export const buildTextWorldGenerationRequest = (input: TextWorldAdapterInput): WorldGenerationRequest => {
  if (!isWorldGenLaneEnabled()) {
    throw new Error("World Generation lane is disabled (set VITE_FEATURE_WORLD_GEN_LANE=1 to enable).");
  }

  const targetWorldAssetId = resolveWorldAssetId(input.targetRef, input);
  const baseWorldAssetId = input.baseRef === undefined ? undefined : resolveWorldAssetId(input.baseRef, input);
  const conditions: ModelCondition[] = [];
  const prompt = String(input.prompt ?? "").trim();
  if (prompt.length > 0) {
    conditions.push({ id: "prompt", type: "text", payload: { text: prompt } });
  }

  const request: WorldGenerationRequest = {
    requestId: createWorldGenerationRequestId(),
    kind: "text_to_world",
    targetWorldAssetId,
    baseWorldAssetId,
    conditions,
    seed: input.seed,
    backendOptions: input.backendOptions,
    metadata: input.metadata,
  };
  return worldGenerationRequestSchema.parse(request);
};
