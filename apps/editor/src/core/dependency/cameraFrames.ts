import { CameraTakeSource, type CameraFrame } from "../../domain/render/cameraTakeSource";
import { defaultRenderPassSpec, type RenderPassSpec } from "../../domain/render/types";
import { readShotTimeFps } from "../../domain/shot/queries";
import type { Shot } from "../../domain/shot/types";
import { hashNormalized } from "./hash";

/**
 * Image size passed to `CameraTakeSource` when a render spec is not on the shot.
 * Intrinsics follow this size. Pose still comes from the selected take.
 */
export const cameraPassRenderSpec: RenderPassSpec = defaultRenderPassSpec(1280, 720);

/**
 * One resolved frame stored in a pass hash.
 * Same fields as `resolveCameraTakeFrames`, which `CameraTakeSource` already calls.
 * `cameraId` is not copied. No take id, calibration id, or `act_` / `obj_` / `cam_` string.
 */
export type CameraPassFrame = Omit<CameraFrame, "cameraId">;

export type CameraPassFrames =
  | { ok: true; frames: CameraPassFrame[]; framesHash: string; fps: number }
  | { ok: false; message: string };

const ID_STRING = /^(?:cam_|act_|obj_|take-)/;

const containsIdString = (value: unknown): boolean => {
  if (typeof value === "string") {
    return ID_STRING.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsIdString(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => key === "cameraId" || key === "calibrationId" || key === "id" || key === "name" || containsIdString(item),
    );
  }
  return false;
};

const passFrame = (frame: CameraFrame): CameraPassFrame | undefined => {
  if (!Number.isInteger(frame.frame)) {
    return undefined;
  }
  return {
    frame: frame.frame,
    position: frame.position,
    rotation: frame.rotation,
    focalLengthMm: frame.focalLengthMm,
    ...(frame.focusDistanceM !== undefined ? { focusDistanceM: frame.focusDistanceM } : {}),
    ...(frame.aperture !== undefined ? { aperture: frame.aperture } : {}),
    intrinsics: frame.intrinsics,
    c2w: frame.c2w,
  };
};

/**
 * Frames a camera-dependent pass hashes.
 *
 * Calls `CameraTakeSource.trajectory`, the only reader of `resolveCameraTakeFrames`
 * on the render path. Does not sample the take again. Frames are integers from
 * `0` through `durationFrames - 1`. fps is `readShotTimeFps` (`Shot.time.fps`).
 * A missing rate throws. `shotFps` is display-only and is not read here.
 * The returned digest is `hashNormalized` of those frames. Ids are not part of the digest.
 * Does not write the shot or the cache.
 */
export const cameraPassFrames = (shot: Shot, spec: RenderPassSpec = cameraPassRenderSpec): CameraPassFrames => {
  const count = shot.time.durationFrames;
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, message: "카메라 프레임은 정수여야 합니다." };
  }
  const fps = readShotTimeFps(shot);
  const requested = Array.from({ length: count }, (_, frame) => frame);
  const trajectory = CameraTakeSource.trajectory(shot, spec, requested);
  if (!trajectory.ok) {
    return { ok: false, message: trajectory.reason };
  }
  if (trajectory.fps !== fps) {
    return { ok: false, message: "fps는 Shot.time.fps 에서만 읽습니다." };
  }
  const frames: CameraPassFrame[] = [];
  for (const frame of trajectory.frames) {
    const sampled = passFrame(frame);
    if (!sampled) {
      return { ok: false, message: "카메라 프레임은 정수여야 합니다." };
    }
    frames.push(sampled);
  }
  if (containsIdString(frames)) {
    return { ok: false, message: "카메라 프레임 해시에 ID 문자열이 있습니다." };
  }
  return { ok: true, frames, framesHash: hashNormalized(frames), fps: trajectory.fps };
};
