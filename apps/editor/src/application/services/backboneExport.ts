import type { Project } from "../../domain/project/types";
import { cameraPathParamsFromNode, type CameraPathParams } from "../../domain/graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode, type LensParams } from "../../domain/graph/lens";
import { BackboneCameraBuilder, type BackboneCamera } from "../../domain/rendering/backboneV01";
import { readShotTimeFps, selectedTake } from "../../domain/shot";
import { cameraPathNodeIdForClip } from "./viewportCommit";

export interface BackboneCameraExportOptions {
  numFrames?: number;
  near?: number;
  far?: number;
  sensorFit?: "horizontal" | "vertical" | "auto";
}

/**
 * Build a Backbone v0.1 camera trajectory for a clip.
 * Frame rate is `Shot.time.fps`. A ready camera take supplies the virtual keys.
 * An empty shot camera still reads CameraPathNode. LensNode supplies the sensor preset.
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
  const shot = project.shots?.[clipId];
  if (!shot) {
    throw new Error("Shot record is required.");
  }
  const fps = readShotTimeFps(shot);
  const pathNodeId = cameraPathNodeIdForClip(clip);
  const pathNode = project.nodes[pathNodeId];
  const take = selectedTake(shot);
  const params: CameraPathParams = take
    ? {
        keyframes: take.keys.map((key) => ({
          frame: key.frame,
          position: [key.position[0], key.position[1], key.position[2]],
          rotation: [key.rotation[0], key.rotation[1], key.rotation[2], key.rotation[3]],
          focalLengthMm: key.focalLengthMm,
          focusDistanceM: key.focusDistanceM,
          aperture: key.aperture,
        })),
        takes: [],
        interpolation: shot.camera.interpolation,
        frameCount: shot.time.durationFrames,
      }
    : cameraPathParamsFromNode(pathNode?.parameters ?? {});
  if (!take && !pathNode) {
    throw new Error("CameraPathNode not found.");
  }
  const lensNode = project.nodes[lensNodeIdForClip(clip.id)];
  const lens: LensParams = lensParamsFromNode(lensNode?.parameters ?? { focalLengthMm: shot.camera.lens.focalLengthMm });
  return BackboneCameraBuilder.buildFromCameraPath({
    params,
    lens: {
      ...lens,
      focalLengthMm: shot.camera.lens.focalLengthMm,
      focusDistanceM: shot.camera.lens.focusDistanceM ?? lens.focusDistanceM,
      aperture: shot.camera.lens.aperture ?? lens.aperture,
    },
    imageSize,
    fps,
    numFrames: options?.numFrames ?? shot.time.durationFrames,
    near: options?.near,
    far: options?.far,
    sensorFit: options?.sensorFit,
  });
};

