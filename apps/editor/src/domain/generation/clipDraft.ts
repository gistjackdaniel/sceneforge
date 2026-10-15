import { z } from "zod";
import type { TimelineClip } from "../timeline/types";
import type { AssetRecord } from "../assets/types";

export type DraftReferenceKind = "image" | "video" | "audio" | "mesh" | "world" | "pose_track" | "camera_path";

export interface DraftReference {
  id: string;
  kind: DraftReferenceKind;
  /** Referenced AssetRecord id when applicable (world, image, video, audio, mesh). */
  assetId?: string;
  /** Optional label shown in UI. */
  label?: string;
  /** Optional link to external storyboard/keyframe metadata in timeline (never a condition). */
  metadataRefId?: string;
  /** Image-only: conditioning mode — reference (soft guidance) vs hard (strict). Default reference. */
  imageMode?: "reference" | "hard";
  /** Image-only: soft guidance strength (0..1), default ~0.3. Ignored in hard mode. */
  guidance?: number;
}

export const draftReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.union([
    z.literal("image"),
    z.literal("video"),
    z.literal("audio"),
    z.literal("mesh"),
    z.literal("world"),
    z.literal("pose_track"),
    z.literal("camera_path"),
  ]),
  assetId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  metadataRefId: z.string().min(1).optional(),
  imageMode: z.union([z.literal("reference"), z.literal("hard")]).optional(),
  guidance: z.number().min(0).max(1).optional(),
});

export interface ClipDraft {
  id: string; // equals TimelineClip.id (one draft per shot)
  clipId: string;
  modelId: string;
  /** Natural language motion prompt. */
  prompt: string;
  /** Camera movement suggestion derived from camera path (#13). Immutable hint; users may copy into prompt. */
  cameraMovementSuggestion?: string;
  /** Output dimensions in pixels. */
  width: number;
  height: number;
  /** Frames per second. */
  fps: number;
  /** Output duration in seconds. Frame count is derived as round(durationSeconds * fps). */
  durationSeconds: number;
  /** Number of parallel outputs to request. */
  outputCount: number;
  /** Attached references (assets or authored signals). */
  references: DraftReference[];
  /** When a run completes, lock the duration for the take. */
  completed?: { frameCount: number; width: number; height: number; fps: number; completedAt: string };
  /** Timestamps for auditing. */
  createdAt: string;
  updatedAt: string;
}

export const clipDraftSchema = z.object({
  id: z.string().min(1),
  clipId: z.string().min(1),
  modelId: z.string().min(1),
  prompt: z.string().default(""),
  cameraMovementSuggestion: z.string().optional(),
  width: z.number().int().min(16).default(1280),
  height: z.number().int().min(16).default(720),
  fps: z.number().int().min(1).default(24),
  durationSeconds: z.number().positive().default(4),
  outputCount: z.number().int().min(1).max(8).default(1),
  references: z.array(draftReferenceSchema).default([]),
  completed: z
    .object({
      frameCount: z.number().int().min(1),
      width: z.number().int().min(16),
      height: z.number().int().min(16),
      fps: z.number().int().min(1),
      completedAt: z.string().min(1),
    })
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createEmptyClipDraft = (clip: Pick<TimelineClip, "id">, defaults?: Partial<ClipDraft>): ClipDraft => {
  const now = new Date().toISOString();
  const draft: ClipDraft = {
    id: clip.id,
    clipId: clip.id,
    modelId: defaults?.modelId ?? "lyra-2.0",
    prompt: defaults?.prompt ?? "",
    cameraMovementSuggestion: defaults?.cameraMovementSuggestion,
    width: defaults?.width ?? 1280,
    height: defaults?.height ?? 720,
    fps: defaults?.fps ?? 24,
    durationSeconds: defaults?.durationSeconds ?? 4,
    outputCount: defaults?.outputCount ?? 1,
    references: defaults?.references ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return clipDraftSchema.parse(draft);
};

export type DraftValidationIssue = {
  field: string;
  message: string;
  severity?: "error" | "warning";
};

export interface DraftValidationResult {
  ok: boolean;
  issues: DraftValidationIssue[];
}

export const upsertReference = (references: DraftReference[], ref: DraftReference): DraftReference[] => {
  // Default image guidance to reference mode with gentle strength when not specified.
  const normalized: DraftReference = (() => {
    if (ref.kind !== "image") return ref;
    const safeGuidance =
      typeof ref.guidance === "number" && isFinite(ref.guidance) ? Math.max(0, Math.min(1, ref.guidance)) : 0.3;
    return { imageMode: "reference", ...ref, guidance: safeGuidance };
  })();
  const index = references.findIndex((r) => r.id === ref.id && r.kind === ref.kind);
  const next = [...references];
  if (index >= 0) next[index] = normalized;
  else next.push(normalized);
  return next;
};

export const removeReference = (references: DraftReference[], refId: string): DraftReference[] =>
  references.filter((r) => r.id !== refId);

/** Return candidate '@' mention targets by type. */
export const mentionCandidates = (assets: Record<string, AssetRecord>, opts?: { kinds?: DraftReferenceKind[] }): DraftReference[] => {
  const allowed = new Set((opts?.kinds ?? ["image", "video", "audio", "mesh", "world"]) as DraftReferenceKind[]);
  return Object.values(assets)
    .filter((a) => {
      if (a.type === "world") return allowed.has("world");
      if (a.type === "image") return allowed.has("image");
      if (a.type === "video") return allowed.has("video");
      if (a.type === "audio") return allowed.has("audio");
      if (a.type === "mesh" || a.type === "generated_proxy" || a.type === "point_cloud" || a.type === "splat") return allowed.has("mesh");
      return false;
    })
    .map((a) => ({ id: a.id, kind: (a.type === "world" ? "world" : (a.type as "image" | "video" | "audio" | "mesh")), assetId: a.id, label: a.name }));
};

