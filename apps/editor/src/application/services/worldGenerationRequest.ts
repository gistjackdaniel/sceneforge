import { z } from "zod";
import {
  normalizeRenderRequest,
  validateRenderRequest,
  type RenderRequest,
  type ValidationResult,
} from "../../domain/rendering/request";

/** Generation-only exploration path. Never written to a clip CameraPathNode. */
export const DEFAULT_EXPLORATION_TRAJECTORY = {
  label: "generation-explore",
  frameCount: 24,
} as const;

export const worldGenerationArtifactsSchema = z.object({
  generatedSegmentPath: z.string().optional(),
  spatialMemoryPath: z.string().optional(),
  visualLayer3dgsPath: z.string().optional(),
  surfaceMeshPath: z.string().optional(),
  navmeshPath: z.string().optional(),
  collisionMeshPath: z.string().optional(),
  memoryCoverage: z.number().optional(),
  generatedAreaRatio: z.number().optional(),
  previewImagePath: z.string().optional(),
  jobId: z.string().optional(),
});

export type WorldGenerationArtifacts = z.infer<typeof worldGenerationArtifactsSchema>;

export interface WorldGenerationInput {
  referenceAssetIds: string[];
  sourceImageUri: string;
  sourceImageName: string;
  prompt?: string;
  seed?: number;
  /** Optional generation trajectory. Defaults to DEFAULT_EXPLORATION_TRAJECTORY. */
  explorationTrajectory?: { label: string; frameCount: number };
  connectorId?: string;
}

export const validateWorldGenerationInput = (input: WorldGenerationInput): ValidationResult => {
  const issues: string[] = [];
  if (input.referenceAssetIds.length === 0) {
    issues.push("Reference image is required.");
  }
  if (input.referenceAssetIds.length > 1) {
    issues.push("This connector supports a single reference image.");
  }
  if (!input.sourceImageUri) {
    issues.push("Reference image URI is missing.");
  }
  if (input.seed !== undefined && (!Number.isFinite(input.seed) || input.seed < 0)) {
    issues.push("Seed must be a non-negative number.");
  }
  return { ok: issues.length === 0, issues };
};

export const isSupportedImageFile = (file: { type: string; name: string; size: number }): ValidationResult => {
  const issues: string[] = [];
  const mimeOk = file.type.startsWith("image/");
  const nameOk = /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
  if (!mimeOk && !nameOk) {
    issues.push("선택한 파일은 이미지여야 합니다.");
  }
  if (file.size <= 0) {
    issues.push("이미지 파일이 비어 있습니다.");
  }
  return { ok: issues.length === 0, issues };
};

/**
 * Build a normalized image_to_world RenderRequest.
 * Accepts one primary reference now; extra IDs are reserved for later connectors.
 */
export const buildImageToWorldRequest = (input: WorldGenerationInput): RenderRequest => {
  const trajectory = input.explorationTrajectory ?? DEFAULT_EXPLORATION_TRAJECTORY;
  const primaryAssetId = input.referenceAssetIds[0];
  return normalizeRenderRequest({
    task: "image_to_world",
    seed: input.seed,
    frameCount: trajectory.frameCount,
    conditions: [
      {
        id: "ref-image",
        type: "image",
        assetId: primaryAssetId,
        payload: { path: input.sourceImageUri, name: input.sourceImageName },
      },
      ...(input.prompt
        ? [{ id: "prompt", type: "text" as const, payload: { text: input.prompt } }]
        : []),
      {
        id: "explore-camera",
        type: "camera",
        payload: { label: trajectory.label, frameCount: trajectory.frameCount, role: "generation" },
      },
    ],
    backendOptions: {
      connectorId: input.connectorId ?? "lyra-2.0",
      sourceImagePath: input.sourceImageUri,
      explorationTrajectory: true,
    },
  });
};

export const validateImageToWorldRequest = (request: RenderRequest): ValidationResult => {
  const base = validateRenderRequest(request);
  const issues = [...base.issues];
  if (request.task !== "image_to_world") {
    issues.push("Task must be image_to_world.");
  }
  const imageConditions = request.conditions.filter((condition) => condition.type === "image");
  if (imageConditions.length !== 1) {
    issues.push("Exactly one reference image is required.");
  }
  return { ok: issues.length === 0, issues };
};

export const parseWorldGenerationArtifacts = (
  value: unknown,
): { ok: true; artifacts: WorldGenerationArtifacts } | { ok: false; issues: string[] } => {
  const parsed = worldGenerationArtifactsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: ["커넥터 응답이 올바르지 않습니다."] };
  }
  return { ok: true, artifacts: parsed.data };
};

export const toUserFacingGenerationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "World generation failed.";
  const lower = message.toLowerCase();
  if (lower.includes("cancel")) {
    return "월드 생성이 취소되었습니다.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "커넥터 응답이 지연되어 중단되었습니다. 다시 시도해 주세요.";
  }
  if (lower.includes("validat")) {
    return "생성 요청이 올바르지 않습니다. 참조 이미지를 확인한 뒤 다시 시도해 주세요.";
  }
  if (lower.includes("malformed") || lower.includes("parse") || lower.includes("올바르지 않습니다")) {
    return "커넥터 응답을 해석할 수 없습니다. 프로젝트는 변경되지 않았습니다.";
  }
  return "월드 생성에 실패했습니다. 다시 시도해 주세요.";
};
