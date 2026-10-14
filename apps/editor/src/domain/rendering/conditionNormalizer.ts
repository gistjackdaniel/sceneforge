import type { ModelCondition } from "./request";
import type { CameraPathParams } from "../graph/cameraPath";
import type { LensParams } from "../graph/lens";
import { BackboneCameraBuilder, backbonePoseSchema, type BackbonePose } from "./backboneV01";

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
  /** Reference WorldAsset by id (owned by World Generation). */
  worldAssetId?: string;
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
  /** Optional Backbone v0.1 inputs for single-shot MVP. When provided, the camera condition will emit Backbone-format payload. */
  fps?: number;
  imageSize?: [number, number];
  cameraPath?: CameraPathParams;
  lens?: LensParams;
  /** Pre-validated SMPL-X pose trajectory (Backbone v0.1). */
  pose?: BackbonePose;
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

    if (input.world?.worldAssetId) {
      conditions.push({
        id: "world",
        type: "world_reference",
        payload: {
          worldAssetId: input.world.worldAssetId,
        },
      });
    }

    if (input.camera) {
      // Prefer Backbone v0.1 format when cameraPath + lens + imageSize are provided.
      if (input.cameraPath && input.lens && input.imageSize) {
        const cameraPayload = BackboneCameraBuilder.buildFromCameraPath({
          params: input.cameraPath,
          lens: input.lens,
          imageSize: input.imageSize,
          fps: input.fps ?? 16,
          numFrames: input.camera.frameCount ?? 81,
        });
        conditions.push({
          id: "camera",
          type: "camera",
          payload: {
            format: "backbone_v0.1",
            camera: cameraPayload,
            clipId: input.clipId,
          },
        });
      } else {
        // Legacy minimal payload (preserve tests and call sites without Backbone inputs).
        conditions.push({
          id: "camera",
          type: "camera",
          payload: { label: input.camera.label, frameCount: input.camera.frameCount, clipId: input.clipId },
        });
      }
    }

    // Optional SMPL-X pose payload (Backbone v0.1). Do not auto-convert previs trajectories here.
    if (input.pose) {
      const pose = backbonePoseSchema.parse(input.pose);
      conditions.push({
        id: "pose",
        type: "pose",
        payload: { format: "backbone_v0.1", pose },
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

