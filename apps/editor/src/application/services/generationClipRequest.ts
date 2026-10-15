import { z } from "zod";
import type { Project } from "../../domain/project/types";
import type { TimelineClip } from "../../domain/timeline/types";
import { clipDurationFrames } from "../../domain/timeline/timing";
import type { NodeBase } from "../../domain/graph/types";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode } from "../../domain/graph/lens";
import { GenerationConditionNormalizer } from "../../domain/rendering/conditionNormalizer";
import { exportBackboneSmplxForClip } from "../../domain/performance/exportBackbone";
import { normalizeRenderRequest, type RenderRequest, type ValidationResult } from "../../domain/rendering/request";
import type { ClipDraft } from "../../domain/generation/clipDraft";
import { CameraMovementDescriber } from "../../domain/rendering/cameraMovement";
import { getModelProfile, validateDraftAgainstProfile } from "../../domain/rendering/modelProfile";

export interface BuildRequestInput {
  project: Project;
  clip: TimelineClip;
  nodes: Record<string, NodeBase>;
  draft: ClipDraft;
}

export const generationRequestSchema = z.object({
  task: z.literal("world_to_video"),
  requestId: z.string().min(1),
  frameCount: z.number().int().positive(),
  fps: z.number().int().positive(),
  width: z.number().int().min(16),
  height: z.number().int().min(16),
});

export interface DraftValidationExtended extends ValidationResult {
  warnings: string[];
}

/** Validate motion prompt complexity against duration (heuristic). */
export const validateMotionPromptComplexity = (prompt: string, durationSeconds: number): string[] => {
  const trimmed = prompt.trim();
  if (!trimmed) return [];
  const separators = [",", " and ", " then ", ";", " while "];
  let segments = 1;
  separators.forEach((sep) => {
    segments += (trimmed.split(sep).length - 1);
  });
  const allowed = Math.max(1, Math.floor(durationSeconds / 2) + 1);
  if (segments > allowed) {
    return [
      `Prompt may contain too many distinct actions (${segments}) for ${durationSeconds.toFixed(1)}s. Consider simplifying.`,
    ];
  }
  return [];
};

export const buildGenerationRequestFromDraft = (input: BuildRequestInput): { request: RenderRequest; validation: DraftValidationExtended } => {
  const { project, clip, nodes, draft } = input;
  const model = getModelProfile(draft.modelId);
  const durationFrames = Math.round(draft.durationSeconds * draft.fps);
  const lens = lensParamsFromNode(nodes[lensNodeIdForClip(clip.id)]?.parameters ?? {});
  const camera = cameraPathParamsFromNode(nodes[clip.cameraPathNodeId ?? `node-${clip.id}-trajectory`]?.parameters ?? {});
  const cameraSuggestion = CameraMovementDescriber.describe(camera);

  const conditions = GenerationConditionNormalizer.normalize({
    clipId: clip.id,
    prompt: draft.prompt?.trim() ? draft.prompt : `Camera movement: ${cameraSuggestion}`,
    camera: { label: "authored camera", frameCount: durationFrames },
    fps: draft.fps,
    imageSize: [draft.width, draft.height],
    cameraPath: camera,
    lens,
    pose: exportBackboneSmplxForClip(project, clip.id, { normalizeToFps: draft.fps }),
  }).conditions;

  const request = normalizeRenderRequest({
    task: "world_to_video",
    conditions,
    frameCount: durationFrames,
    fps: draft.fps,
    width: draft.width,
    height: draft.height,
    backendOptions: { model: draft.modelId, outputCount: draft.outputCount },
  });

  const profileValidation = validateDraftAgainstProfile({
    model,
    width: draft.width,
    height: draft.height,
    fps: draft.fps,
    durationSeconds: draft.durationSeconds,
    outputCount: draft.outputCount,
    references: draft.references,
  });
  const promptWarnings = validateMotionPromptComplexity(draft.prompt, draft.durationSeconds);

  const validation: DraftValidationExtended = {
    ...profileValidation,
    warnings: promptWarnings,
  };

  // Assign suggestion onto draft if missing; leave to caller to persist via command.
  if (!draft.cameraMovementSuggestion) {
    draft.cameraMovementSuggestion = cameraSuggestion;
  }
  return { request, validation };
};

