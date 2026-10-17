import type { Project } from "../../domain/project/types";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode } from "../../domain/graph/lens";
import { BackboneCameraBuilder, type BackboneCamera } from "../../domain/rendering/backboneV01";
import { cameraPathNodeIdForClip } from "./viewportCommit";

export interface BackboneCameraExportOptions {
  fps?: number;
  numFrames?: number;
  near?: number;
  far?: number;
  sensorFit?: "horizontal" | "vertical" | "auto";
}

/**
 * Build a Backbone v0.1 camera trajectory from the current project state for a clip.
 * - Uses CameraPathNode keyframes
 * - Uses LensNode for intrinsics
 * - Returns a payload validated by backboneCameraSchema (via builder)
 */
export const buildBackboneCameraForClip = (
  project: Project,
  clipId: string,
  imageSize: [number, number],
  options?: BackboneCameraExportOptions,
): BackboneCamera => {
  const clip = project.clips[clipId];
  if (!clip) {
    throw new Error(`Clip ${clipId} not found.`);
  }
  const pathNodeId = cameraPathNodeIdForClip(clip);
  const pathNode = project.nodes[pathNodeId];
  if (!pathNode) {
    throw new Error("CameraPathNode not found.");
  }
  const lensNode = project.nodes[lensNodeIdForClip(clip.id)];
  const params = cameraPathParamsFromNode(pathNode.parameters ?? {});
  const lens = lensParamsFromNode(lensNode?.parameters ?? {});
  return BackboneCameraBuilder.buildFromCameraPath({
    params,
    lens,
    imageSize,
    fps: options?.fps,
    numFrames: options?.numFrames ?? clip.durationFrames ?? clip.duration,
    near: options?.near,
    far: options?.far,
    sensorFit: options?.sensorFit,
  });
};

