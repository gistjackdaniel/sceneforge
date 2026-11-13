import { BackboneCameraBuilder } from "../rendering/backboneV01";
import type { SensorPreset } from "../graph/lens";
import { sampleCameraPose, selectedTake } from "../shot/queries";
import type { Quat, Shot, Vec3 } from "../shot/types";
import type { RenderPassSpec } from "./types";

export type CameraIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  K: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
};

/**
 * One integer frame of the selected take.
 * `cameraId` is `CameraTake.id` as stored, including a later `cam_<ULID>` or
 * `cam_legacy_…` id. The pass hash does not read this string.
 */
export type CameraFrame = {
  frame: number;
  cameraId: string;
  position: Vec3;
  rotation: Quat;
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  intrinsics: CameraIntrinsics;
  /** OpenCV c2w, same composition as `BackboneCameraBuilder`. */
  c2w: number[][];
};

export type CameraTrajectory = {
  ok: true;
  cameraId: string;
  fps: number;
  frames: CameraFrame[];
};

const sensorPreset = (value: string | undefined): SensorPreset =>
  value === "super35" || value === "micro-four-thirds" || value === "full-frame" ? value : "full-frame";

/**
 * Sole reader of shot-record camera takes for the protected render path.
 *
 * TODO(#34): `feat/scene-camera-track-shot-record` is still settling samples,
 * calibration, mapping, stored intrinsics, quaternion storage, `cam_<ULID>`,
 * and OpenCV c2w export. When that document lands, resolve pose and intrinsics
 * here and keep `CameraFrame` stable. Do not read the take anywhere else in
 * `domain/render`. fps comes from `Shot.time.fps` only.
 */
export class CameraTakeSource {
  static trajectory(shot: Shot, spec: RenderPassSpec, frames: readonly number[]): CameraTrajectory | { ok: false; reason: string } {
    const take = selectedTake(shot);
    if (!take || shot.camera.status !== "ready") {
      return { ok: false, reason: "A selected camera take is required." };
    }
    const imageSize: [number, number] = [spec.width, spec.height];
    const preset = sensorPreset(shot.camera.lens.sensorPreset);
    const sampled = frames.map((frame) => {
      const pose = sampleCameraPose(take, frame, shot.camera.interpolation);
      const lens = {
        focalLengthMm: pose.focalLengthMm,
        sensorPreset: preset,
        ...(pose.focusDistanceM !== undefined ? { focusDistanceM: pose.focusDistanceM } : {}),
        ...(pose.aperture !== undefined ? { aperture: pose.aperture } : {}),
      };
      const K = BackboneCameraBuilder.computeIntrinsicsK(lens, imageSize, "horizontal");
      const rotation: Quat = [pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]];
      const position: Vec3 = [pose.position[0], pose.position[1], pose.position[2]];
      const c2w = BackboneCameraBuilder.composeC2W(
        [position[0], position[1], position[2]],
        BackboneCameraBuilder.glToOpenCvRotation(BackboneCameraBuilder.quatToMat3([rotation[0], rotation[1], rotation[2], rotation[3]])),
      );
      const framePose: CameraFrame = {
        frame,
        cameraId: take.id,
        position,
        rotation,
        focalLengthMm: pose.focalLengthMm,
        intrinsics: { fx: K[0][0], fy: K[1][1], cx: K[0][2], cy: K[1][2], K },
        c2w,
        ...(pose.focusDistanceM !== undefined ? { focusDistanceM: pose.focusDistanceM } : {}),
        ...(pose.aperture !== undefined ? { aperture: pose.aperture } : {}),
      };
      return framePose;
    });
    return { ok: true, cameraId: take.id, fps: shot.time.fps, frames: sampled };
  }
}
