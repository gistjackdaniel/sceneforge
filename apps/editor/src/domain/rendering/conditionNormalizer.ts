import type { ModelCondition } from "./request";

export type SubjectRole = "person" | "object" | "background";

export interface SubjectPlateView {
  viewTag: string;
  assetId: string;
}

export interface SubjectPlates {
  subjectId: string;
  role: SubjectRole;
  views: SubjectPlateView[];
}

export interface WorldReferences {
  /** Optional world-level packaged asset id (placeholder — owned by World Generation bot). */
  worldAssetId?: string;
  /** Spatial memory store id (cache kind: spatial_memory). */
  spatialMemoryAssetId?: string;
  /** Generated segment id (cache kind: generated_segment). */
  generatedSegmentAssetId?: string;
}

export interface CameraSignal {
  label: string;
  frameCount: number;
}

export interface LayoutCue {
  id: string;
  description: string;
}

export interface PerformanceCueSummary {
  id: string;
  label?: string;
  kind?: string;
  startFrame: number;
  endFrame: number;
  actorId?: string;
  targetActorId?: string;
}

export interface SceneSignals {
  clipId: string;
  prompt?: string;
  camera?: CameraSignal;
  world?: WorldReferences;
  subjects?: SubjectPlates[];
  layoutCues?: LayoutCue[];
  performanceCues?: PerformanceCueSummary[];
}

export interface SubjectViewMetadata {
  subjectId: string;
  role: SubjectRole;
  views: string[];
}

export interface ConditionNormalizationResult {
  conditions: ModelCondition[];
  subjectViews: SubjectViewMetadata[];
}

const rolePriority = (role?: unknown): number => {
  switch (role) {
    case "person":
      return 1;
    case "object":
      return 2;
    case "background":
      return 4;
    default:
      return 3;
  }
};

const typePriority = (condition: ModelCondition): number => {
  switch (condition.type) {
    case "text":
      return 0;
    case "image":
      // Images are ranked by role inside the image block using weight
      return 1 + (typeof condition.payload?.role === "string" ? rolePriority(condition.payload.role) : 3);
    case "world_reference":
      return 5;
    case "camera":
      return 6;
    case "motion":
      return 7;
    case "pose":
    case "mask":
    case "video":
    case "depth":
      return 8;
    default:
      return 9;
  }
};

/**
 * Model-agnostic normalizer that converts authored scene signals into
 * ordered ModelCondition[] suitable for RenderRequest. No vendor strings.
 *
 * Ordering rule (high level):
 * - text prompt (if any)
 * - subject reference images (person, object)
 * - background references
 * - world_reference (spatial memory, generated segments, packaged world)
 * - camera
 * - motion/layout cues
 */
export class GenerationConditionNormalizer {
  static normalize(input: SceneSignals): ConditionNormalizationResult {
    const conditions: ModelCondition[] = [];
    const subjectViews: SubjectViewMetadata[] = [];

    if (input.prompt?.trim()) {
      conditions.push({
        id: "prompt",
        type: "text",
        payload: { text: input.prompt },
      });
    }

    (input.subjects ?? []).forEach((subject, subjectIndex) => {
      const viewTags: string[] = [];
      subject.views.forEach((view, viewIndex) => {
        viewTags.push(view.viewTag);
        conditions.push({
          id: `subject:${subject.subjectId}:${view.viewTag}:${viewIndex}`,
          type: "image",
          assetId: view.assetId,
          payload: {
            subjectId: subject.subjectId,
            role: subject.role,
            viewTag: view.viewTag,
            order: { subjectIndex, viewIndex },
          },
          weight: 1,
        });
      });
      subjectViews.push({ subjectId: subject.subjectId, role: subject.role, views: viewTags });
    });

    if (input.world && (input.world.worldAssetId || input.world.spatialMemoryAssetId || input.world.generatedSegmentAssetId)) {
      conditions.push({
        id: "world",
        type: "world_reference",
        payload: {
          clipId: input.clipId,
          worldAssetId: input.world.worldAssetId,
          spatialMemoryAssetId: input.world.spatialMemoryAssetId,
          generatedSegmentAssetId: input.world.generatedSegmentAssetId,
        },
      });
    }

    if (input.camera) {
      conditions.push({
        id: "camera",
        type: "camera",
        payload: { label: input.camera.label, frameCount: input.camera.frameCount, clipId: input.clipId },
      });
    }

    if ((input.layoutCues && input.layoutCues.length > 0) || (input.performanceCues && input.performanceCues.length > 0)) {
      conditions.push({
        id: "layout-and-performance",
        type: "motion",
        payload: {
          layoutCues: input.layoutCues ?? [],
          performanceCues: input.performanceCues ?? [],
        },
      });
    }

    // Ensure deterministic ordering
    conditions.sort((a, b) => typePriority(a) - typePriority(b));

    return { conditions, subjectViews };
  }
}

