import type { ModelCondition } from "../../rendering/request";
import { isWorldGenLaneEnabled } from "./featureFlags";
import { resolveWorldAssetId, type WorldTargetScope } from "./resolveTarget";
import { worldGenerationRequestSchema, type WorldGenerationRequest } from "./types";

export interface VideoWorldAdapterInput extends WorldTargetScope {
  /** Name, alias, tag, or an existing WorldAsset.id. */
  targetRef: string;
  /** Optional base world. Same lookup rules as `targetRef`. */
  baseRef?: string;
  /** Reference video asset id. This is not a WorldAsset id. */
  referenceVideoAssetId: string;
  /** URI passed to a future connector. Not scene state. */
  referenceVideoUri: string;
  /** Clip id carried on camera and video conditions. */
  clipId: string;
  /** Camera label and frame count. The lane stays frame-based. */
  camera: { label?: string; frameCount: number };
  /** Optional text prompt. */
  prompt?: string;
  seed?: number;
  backendOptions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Adapter: video reference -> WorldGenerationRequest.
 *
 * Invalidation: none. Does not write the shot, the world library, or a manifest.
 * Downstream: world fields are `WorldAsset.id` only. The video asset id stays a condition input.
 * Side effects: none. Throws when `VITE_FEATURE_WORLD_GEN_LANE` is off, or when a
 * target cannot be resolved to one `WorldAsset.id` through `TargetResolver`.
 */
export const buildVideoWorldGenerationRequest = (input: VideoWorldAdapterInput): WorldGenerationRequest => {
  if (!isWorldGenLaneEnabled()) {
    throw new Error("World Generation lane is disabled (set VITE_FEATURE_WORLD_GEN_LANE=1 to enable).");
  }

  const targetWorldAssetId = resolveWorldAssetId(input.targetRef, input);
  const baseWorldAssetId = input.baseRef === undefined ? undefined : resolveWorldAssetId(input.baseRef, input);
  const frameCount = Math.max(1, Number(input.camera.frameCount) || 24);
  const conditions: ModelCondition[] = [];

  const prompt = (input.prompt ?? "").trim();
  if (prompt.length > 0) {
    conditions.push({ id: "prompt", type: "text", payload: { text: prompt } });
  }

  if (baseWorldAssetId) {
    conditions.push({
      id: "world",
      type: "world_reference",
      payload: { worldAssetId: baseWorldAssetId },
    });
  }

  const cameraLabel = input.camera.label ?? "generation-explore";
  conditions.push({
    id: "camera",
    type: "camera",
    payload: { label: cameraLabel, frameCount, clipId: input.clipId },
  });

  conditions.push({
    id: "reference-video",
    type: "video",
    assetId: input.referenceVideoAssetId,
    payload: {
      path: input.referenceVideoUri,
      clipId: input.clipId,
      frameCount,
    },
  });

  const request: WorldGenerationRequest = {
    requestId: `wreq-${Date.now().toString(36)}`,
    kind: "video_to_world",
    targetWorldAssetId,
    baseWorldAssetId,
    conditions,
    seed: input.seed,
    backendOptions: input.backendOptions,
    metadata: input.metadata,
  };

  return worldGenerationRequestSchema.parse(request);
};
