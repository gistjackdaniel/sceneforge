import { z } from "zod";
import type { DraftReferenceKind, DraftValidationIssue, DraftValidationResult } from "../generation/clipDraft";

export type ReferenceKind = Extract<DraftReferenceKind, "image" | "video" | "audio" | "mesh" | "world">;

export interface ReferenceLimits {
  total: number;
  perKind: Partial<Record<ReferenceKind, number>>;
}

export interface AllowedResolution {
  width: number;
  height: number;
  fps: number[];
}

export interface ModelCapabilityProfile {
  id: string;
  label: string;
  allowedResolutions: AllowedResolution[];
  /** Maximum duration in seconds per output. */
  maxDurationSeconds: number;
  /** Supported output counts per request (upper bound used for UI clamp). */
  maxOutputCount: number;
  /** Reference limits by kind plus total cap. */
  referenceLimits: ReferenceLimits;
}

export const modelCapabilityProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  allowedResolutions: z
    .array(
      z.object({
        width: z.number().int().min(16),
        height: z.number().int().min(16),
        fps: z.array(z.number().int().min(1)).min(1),
      }),
    )
    .min(1),
  maxDurationSeconds: z.number().positive().default(10),
  maxOutputCount: z.number().int().min(1).default(4),
  referenceLimits: z.object({
    total: z.number().int().min(0).default(0),
    perKind: z
      .object({
        image: z.number().int().min(0).optional(),
        video: z.number().int().min(0).optional(),
        audio: z.number().int().min(0).optional(),
        mesh: z.number().int().min(0).optional(),
        world: z.number().int().min(0).optional(),
      })
      .default({}),
  }),
});

/** Simple in-memory profile registry. Connectors may override at runtime in infrastructure later. */
export const MODEL_PROFILES: Record<string, ModelCapabilityProfile> = {
  "lyra-2.0": modelCapabilityProfileSchema.parse({
    id: "lyra-2.0",
    label: "Lyra 2.0",
    allowedResolutions: [
      { width: 1280, height: 720, fps: [16, 24, 30] },
      { width: 1920, height: 1080, fps: [16, 24, 30] },
    ],
    maxDurationSeconds: 10,
    maxOutputCount: 4,
    referenceLimits: {
      total: 12,
      perKind: { image: 8, video: 2, audio: 1, mesh: 6, world: 1 },
    },
  }),
};

export const getModelProfile = (modelId: string): ModelCapabilityProfile => {
  return MODEL_PROFILES[modelId] ?? MODEL_PROFILES["lyra-2.0"];
};

export const validateDraftAgainstProfile = (input: {
  model: ModelCapabilityProfile;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  outputCount: number;
  references: Array<{ kind: DraftReferenceKind }>;
}): DraftValidationResult => {
  const issues: DraftValidationIssue[] = [];
  const match = input.model.allowedResolutions.find((r) => r.width === input.width && r.height === input.height);
  if (!match) {
    issues.push({
      field: "resolution",
      message: `Resolution ${input.width}×${input.height} is not supported by ${input.model.label}.`,
      severity: "error",
    });
  } else if (!match.fps.includes(input.fps)) {
    issues.push({ field: "fps", message: `${input.fps} fps is not supported for ${input.width}×${input.height}.`, severity: "error" });
  }
  if (input.durationSeconds > input.model.maxDurationSeconds) {
    issues.push({
      field: "durationSeconds",
      message: `Duration exceeds ${input.model.maxDurationSeconds}s limit.`,
      severity: "error",
    });
  }
  if (input.outputCount > input.model.maxOutputCount) {
    issues.push({
      field: "outputCount",
      message: `Output count exceeds ${input.model.maxOutputCount}.`,
      severity: "error",
    });
  }
  const total = input.references.length;
  if (input.model.referenceLimits.total > 0 && total > input.model.referenceLimits.total) {
    issues.push({ field: "references", message: `Too many references (${total}/${input.model.referenceLimits.total}).`, severity: "error" });
  }
  const byKind = new Map<DraftReferenceKind, number>();
  input.references.forEach((r) => byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1));
  (Object.keys(input.model.referenceLimits.perKind) as ReferenceKind[]).forEach((kind) => {
    const cap = input.model.referenceLimits.perKind[kind];
    if (!cap && cap !== 0) return;
    const count = byKind.get(kind) ?? 0;
    if (count > cap!) {
      issues.push({ field: `references.${kind}`, message: `${kind} references exceed ${cap}.`, severity: "error" });
    }
  });
  return { ok: issues.length === 0, issues };
};

