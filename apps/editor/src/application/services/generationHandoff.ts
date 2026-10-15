import type { Project } from "../../domain/project/types";
import type { TimelineClip } from "../../domain/timeline/types";
import type { NodeBase } from "../../domain/graph/types";
import type { RenderRequest } from "../../domain/rendering/request";
import { buildGenerationRequestFromDraft, type DraftValidationExtended } from "./generationClipRequest";
import type { ClipDraft } from "../../domain/generation/clipDraft";
import { computeClipCacheDependencyHash } from "../../core/dependency";

/** Typed DTO passed to the Agentic system bot (kept behind the bridge, not UI). */
export interface GenerationHandoffDTO {
  clipId: string;
  /** Stable dependency hash for this clip's blocking plan. Matches #14 cacheKey shape: final:clipId:depHash */
  depHash: string;
  /** Convenience composite key (stubbed to match #14): final:clipId:depHash */
  cacheKey: string;
  /** Normalized, model-agnostic request payload. */
  request: RenderRequest;
}

/** Structured failure reason, suitable to surface as RenderFailed and enable agent retry logic. */
export interface GenerationBuildFailure {
  code: "VALIDATION_ERROR" | "MISSING_DEPENDENCY" | "UNSUPPORTED_PROFILE" | "INTERNAL_ERROR";
  message: string;
  details?: Record<string, unknown>;
  clipId: string;
  depHash?: string;
  cacheKey?: string;
  retryable: boolean;
}

export type GenerationHandoffResult =
  | { ok: true; dto: GenerationHandoffDTO; validation: DraftValidationExtended }
  | { ok: false; failure: GenerationBuildFailure; validation: DraftValidationExtended };

const extractDepHash = (clipId: string, value: string | undefined, project: Project): string => {
  if (value && value.length > 0) return value;
  // Fallback: compute a deterministic hash from the current graph snapshot
  const computed = computeClipCacheDependencyHash(clipId as any, project.clipGraphs as any, project.nodes as any);
  const suffix = computed.split("-").pop() ?? computed;
  return suffix;
};

/** Build a typed handoff DTO for the agent, without mutating state or queuing renders. */
export const prepareGenerationHandoff = (input: {
  project: Project;
  clip: TimelineClip;
  nodes: Record<string, NodeBase>;
  draft: ClipDraft;
}): GenerationHandoffResult => {
  const { project, clip, nodes, draft } = input;
  const { request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes, draft });

  const depHash = extractDepHash(clip.id, project.dependencyMap.cacheHashesByClipId[clip.id], project);
  const cacheKey = `final:${clip.id}:${depHash}`; // #14 shape (stubbed when #14 is not present)

  if (!validation.ok) {
    return {
      ok: false,
      failure: {
        code: "VALIDATION_ERROR",
        message: "Draft validation failed for GenerationRequest.",
        details: { issues: validation.issues, warnings: validation.warnings, modelId: draft.modelId },
        clipId: clip.id,
        depHash,
        cacheKey,
        retryable: false,
      },
      validation,
    };
  }

  return {
    ok: true,
    dto: {
      clipId: clip.id,
      depHash,
      cacheKey,
      request,
    },
    validation,
  };
};

