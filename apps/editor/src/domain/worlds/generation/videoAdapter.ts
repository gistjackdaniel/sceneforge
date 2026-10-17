import { worldGenerationRequestSchema, type WorldGenerationRequest } from "./types";
import { isWorldGenLaneEnabled } from "./featureFlags";
import type { ModelCondition } from "../../rendering/request";

export interface VideoWorldAdapterInput {
  /** Existing or planned world to write into. */
  targetWorldAssetId: string;
  /** Optional base/reference world already packaged. */
  baseWorldAssetId?: string;
  /** Reference video (as an asset) to condition the world generation. */
  referenceVideoAssetId: string;
  /** URI for local/remote path for the reference video (for connectors). */
  referenceVideoUri: string;
  /** Clip to associate with camera signal and conditions. */
  clipId: string;
  /** Camera label and frame count — the lane is frame-based, not time-based. */
  camera: { label?: string; frameCount: number };
  /** Optional text prompt to bias generation. */
  prompt?: string;
  seed?: number;
  backendOptions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Adapter: video reference -> WorldGenerationRequest
 * - References WorldAsset by id only
 * - Includes a camera condition for the clip with given frameCount
 * - Gated by feature flag (OFF by default)
 */
export const buildVideoWorldGenerationRequest = (input: VideoWorldAdapterInput): WorldGenerationRequest => {
  if (!isWorldGenLaneEnabled()) {
    throw new Error("World Generation lane is disabled (set VITE_FEATURE_WORLD_GEN_LANE=1 to enable).");
  }

  const conditions: ModelCondition[] = [];

  const prompt = (input.prompt ?? "").trim();
  if (prompt.length > 0) {
    conditions.push({ id: "prompt", type: "text", payload: { text: prompt } });
  }

  if (input.baseWorldAssetId) {
    conditions.push({
      id: "world",
      type: "world_reference",
      payload: { worldAssetId: input.baseWorldAssetId },
    });
  }

  const cameraLabel = input.camera.label ?? "generation-explore";
  conditions.push({
    id: "camera",
    type: "camera",
    payload: { label: cameraLabel, frameCount: Math.max(1, Number(input.camera.frameCount) || 24), clipId: input.clipId },
  });

  conditions.push({
    id: "reference-video",
    type: "video",
    assetId: input.referenceVideoAssetId,
    payload: {
      path: input.referenceVideoUri,
      clipId: input.clipId,
      frameCount: Math.max(1, Number(input.camera.frameCount) || 24),
    },
  });

  const request: WorldGenerationRequest = {
    requestId: `wreq-${Date.now().toString(36)}`,
    kind: "video_to_world",
    targetWorldAssetId: input.targetWorldAssetId,
    baseWorldAssetId: input.baseWorldAssetId,
    conditions,
    seed: input.seed,
    backendOptions: input.backendOptions,
    metadata: input.metadata,
  };

  const parsed = worldGenerationRequestSchema.parse(request);
  return parsed as WorldGenerationRequest;
};

