import { resolveCameraTakeFrames, selectedTake } from "../shot/queries";
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
 * `cameraId` is the stored `CameraTake.id` (`cam_<ULID>` or `cam_legacy_*`).
 * The pass hash does not read this string.
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

/**
 * Sole reader of shot-record camera takes for the protected render path.
 *
 * Pose, intrinsics, and OpenCV c2w come from `resolveCameraTakeFrames`, which
 * applies calibration, tracking-loss fill, drift correction, and motion
 * mapping before sampling. `cameraId` is attached here from `CameraTake.id`
 * (`cam_<ULID>`, or `cam_legacy_*` after migration) and is not part of that
 * return value or the pass hash. Do not read the take anywhere else in
 * `domain/render`. fps comes from `Shot.time.fps` only.
 */
export class CameraTakeSource {
  static trajectory(shot: Shot, spec: RenderPassSpec, frames: readonly number[]): CameraTrajectory | { ok: false; reason: string } {
    const take = selectedTake(shot);
    if (!take || shot.camera.status !== "ready") {
      return { ok: false, reason: "A selected camera take is required." };
    }
    const resolved = resolveCameraTakeFrames(take, shot, {
      frames,
      imageSize: [spec.width, spec.height],
    });
    if (resolved.length !== frames.length) {
      return { ok: false, reason: "The selected camera take has no frames." };
    }
    const sampled = resolved.map((pose) => {
      const rotation: Quat = [pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]];
      const position: Vec3 = [pose.position[0], pose.position[1], pose.position[2]];
      const K = pose.intrinsics.K;
      const framePose: CameraFrame = {
        frame: pose.frame,
        cameraId: take.id,
        position,
        rotation,
        focalLengthMm: pose.focalLengthMm,
        intrinsics: {
          fx: pose.intrinsics.fx,
          fy: pose.intrinsics.fy,
          cx: pose.intrinsics.cx,
          cy: pose.intrinsics.cy,
          K: [
            [K[0][0], K[0][1], K[0][2]],
            [K[1][0], K[1][1], K[1][2]],
            [K[2][0], K[2][1], K[2][2]],
          ],
        },
        c2w: pose.c2w.map((row) => [row[0], row[1], row[2], row[3]]),
        ...(pose.focusDistanceM !== undefined ? { focusDistanceM: pose.focusDistanceM } : {}),
        ...(pose.aperture !== undefined ? { aperture: pose.aperture } : {}),
      };
      return framePose;
    });
    return { ok: true, cameraId: take.id, fps: shot.time.fps, frames: sampled };
  }
}
