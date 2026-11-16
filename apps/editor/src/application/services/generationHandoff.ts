import type { Project } from "../../domain/project/types";
import type { TimelineClip } from "../../domain/timeline/types";
import type { NodeBase } from "../../domain/graph/types";
import type { RenderRequest } from "../../domain/rendering/request";
import { buildGenerationRequestFromDraft, type DraftValidationExtended } from "./generationClipRequest";
import type { ClipDraft } from "../../domain/generation/clipDraft";
import { computeClipCacheDependencyHash, computePassHash } from "../../core/dependency";

/** Identity fields. They name a clip, shot, or request and are not part of the pass. */
const IDENTITY_KEYS = new Set(["id", "clipId", "shotId", "requestId", "nodeId", "metadataRefId"]);

/** Drop clip, shot, and request identity so equal authored input hashes the same. */
const omitIdentity = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(omitIdentity);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEYS.has(key)) continue;
    out[key] = omitIdentity(nested);
  }
  return out;
};

/** Cache key for a generation pass. Uses `computePassHash` and no clip or shot id. */
export const generationPassCacheKey = (request: RenderRequest): string => computePassHash(omitIdentity(request));

/** Typed DTO passed to the Agentic system bot (kept behind the bridge, not UI). */
export interface GenerationHandoffDTO {
  clipId: string;
  /** Dependency hash of the clip graph. Not the generation cache key. */
  depHash: string;
  /** `computePassHash` of the request with identity fields removed. */
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
  const shot = project.shots?.[clip.id];
  if (!shot) {
    return {
      ok: false,
      failure: {
        code: "MISSING_DEPENDENCY",
        message: "Shot time.fps is required.",
        clipId: clip.id,
        retryable: false,
      },
      validation: { ok: false, issues: [{ field: "fps", message: "Shot time.fps is required." }], warnings: [] },
    };
  }
  let request: RenderRequest;
  let validation: DraftValidationExtended;
  try {
    ({ request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes, draft, shot }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shot time.fps is required.";
    return {
      ok: false,
      failure: {
        code: "MISSING_DEPENDENCY",
        message,
        clipId: clip.id,
        retryable: false,
      },
      validation: { ok: false, issues: [{ field: "fps", message }], warnings: [] },
    };
  }

  const depHash = extractDepHash(clip.id, project.dependencyMap.cacheHashesByClipId[clip.id], project);
  const cacheKey = generationPassCacheKey(request);

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

