import { z } from "zod";
import { frameToTimecode } from "./timecode";
import { normalizeQuat } from "./cameraRotation";
import { CameraTrackInputError, type CameraTrackCapture, type CameraTrackInputAdapter } from "./cameraTrack";
import { devicePoseToScenePose, devicePointToScene, poseFromColumnMajor, type DeviceFramework } from "./deviceFrame";
import { deviceTimestampToFrame, type DeviceTimestampToFrame } from "./deviceTimestamp";
import { trackingEventsForLoss } from "./trackingContinuity";
import type { TrackingState, Vec3 } from "./types";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quat = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);

const rawTrackingStateSchema = z.enum([
  "normal",
  "limited",
  "not_available",
  "notAvailable",
  "TRACKING",
  "PAUSED",
  "STOPPED",
  "tracked",
  "emulated",
  "lost",
]);

const mobileIntrinsicsSchema = z.object({
  imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  fx: z.number().finite().optional(),
  fy: z.number().finite().optional(),
  cx: z.number().finite().optional(),
  cy: z.number().finite().optional(),
  K: z.tuple([vec3, vec3, vec3]).optional(),
  focalLengthMm: z.number().positive().optional(),
  sensorSizeMm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  sensorFit: z.enum(["horizontal", "vertical", "auto"]).optional(),
  distortion: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]).optional(),
});

const mobilePoseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quaternion"), position: vec3, rotation: quat }),
  z.object({ kind: z.literal("matrix"), transform: z.array(z.number().finite()).length(16) }),
]);

/**
 * Recorded mobile session. No live device or network.
 * Poses are camera-to-world in the device session frame. Timestamps are monotonic nanoseconds.
 */
export const mobileCameraSessionSchema = z.object({
  framework: z.enum(["arkit", "arcore", "webxr"]),
  cameraLocal: z.enum(["gl", "opencv"]).optional(),
  frames: z.array(z.object({
    timestampNs: z.number().int().nonnegative(),
    pose: mobilePoseSchema,
    trackingState: rawTrackingStateSchema,
    intrinsics: mobileIntrinsicsSchema.optional(),
  })).min(1),
  intrinsics: mobileIntrinsicsSchema.optional(),
});

export type MobileCameraSession = z.infer<typeof mobileCameraSessionSchema>;

const TRACKING_STATE: Record<z.infer<typeof rawTrackingStateSchema>, TrackingState> = {
  normal: "normal",
  limited: "limited",
  not_available: "not_available",
  notAvailable: "not_available",
  TRACKING: "normal",
  PAUSED: "limited",
  STOPPED: "not_available",
  tracked: "normal",
  emulated: "limited",
  lost: "not_available",
};

const matrixFromPixels = (
  fx: number,
  fy: number,
  cx: number,
  cy: number,
): [[number, number, number], [number, number, number], [number, number, number]] => [
  [fx, 0, cx],
  [0, fy, cy],
  [0, 0, 1],
];

const intrinsicsFrom = (
  value: z.infer<typeof mobileIntrinsicsSchema> | undefined,
): CameraTrackCapture["intrinsics"] => {
  if (!value) return undefined;
  const K = value.K
    ? [
      [value.K[0][0], value.K[0][1], value.K[0][2]] as [number, number, number],
      [value.K[1][0], value.K[1][1], value.K[1][2]] as [number, number, number],
      [value.K[2][0], value.K[2][1], value.K[2][2]] as [number, number, number],
    ] as [[number, number, number], [number, number, number], [number, number, number]]
    : value.fx !== undefined && value.fy !== undefined && value.cx !== undefined && value.cy !== undefined
      ? matrixFromPixels(value.fx, value.fy, value.cx, value.cy)
      : undefined;
  return {
    imageSize: value.imageSize ? [value.imageSize[0], value.imageSize[1]] : undefined,
    K,
    focalLengthMm: value.focalLengthMm,
    sensorSizeMm: value.sensorSizeMm ? [value.sensorSizeMm[0], value.sensorSizeMm[1]] : undefined,
    sensorFit: value.sensorFit,
    distortion: value.distortion
      ? [value.distortion[0], value.distortion[1], value.distortion[2], value.distortion[3], value.distortion[4]]
      : undefined,
  };
};

const poseOf = (framework: DeviceFramework, pose: MobileCameraSession["frames"][number]["pose"], cameraLocal: "gl" | "opencv") => {
  const device = pose.kind === "matrix"
    ? poseFromColumnMajor(pose.transform)
    : { position: pose.position as Vec3, rotation: pose.rotation };
  return devicePoseToScenePose(framework, device, cameraLocal);
};

/**
 * Read a recorded ARKit, ARCore, or WebXR session as a `CameraTrackCapture`.
 * Axis conversion happens here. World calibration, loss fill, and drift stay layers.
 * `fps` is the caller's `Shot.time.fps`. `timestampToFrame` defaults to the
 * stand-in that the Timeline lane will replace.
 */
export const createMobileSessionAdapter = (
  session: unknown,
  options: {
    fps: number;
    timestampToFrame?: DeviceTimestampToFrame;
    originTimestampNs?: number;
  },
): CameraTrackInputAdapter => ({
  id: "mobile-session",
  readCapture: (signal) => {
    if (signal?.aborted) return Promise.reject(new CameraTrackInputError("Camera track capture was cancelled."));
    const parsed = mobileCameraSessionSchema.safeParse(session);
    if (!parsed.success) return Promise.reject(new CameraTrackInputError("Mobile session did not match the scene contract."));
    if (!(typeof options.fps === "number" && Number.isFinite(options.fps) && options.fps > 0)) {
      return Promise.reject(new CameraTrackInputError("Mobile session needs Shot.time.fps."));
    }
    const toFrame = options.timestampToFrame ?? deviceTimestampToFrame;
    const cameraLocal = parsed.data.cameraLocal ?? "gl";
    const ordered = [...parsed.data.frames].sort((left, right) => left.timestampNs - right.timestampNs);
    const origin = options.originTimestampNs ?? ordered[0]?.timestampNs ?? 0;
    type SessionSample = CameraTrackCapture["samples"][number] & { trackingState: TrackingState };
    const byFrame = new Map<number, SessionSample>();
    for (const frame of ordered) {
      let index: number;
      try {
        index = toFrame({ deviceTimestampNs: frame.timestampNs, originTimestampNs: origin, fps: options.fps });
      } catch {
        return Promise.reject(new CameraTrackInputError("Mobile session needs Shot.time.fps."));
      }
      if (index < 0) continue;
      const scene = poseOf(parsed.data.framework, frame.pose, cameraLocal);
      const point = devicePointToScene(parsed.data.framework, scene.position);
      byFrame.set(index, {
        frame: index,
        position: [point[0], point[1], point[2]],
        rotation: normalizeQuat(scene.rotation),
        deviceTimestampNs: frame.timestampNs,
        timecode: frameToTimecode(index, options.fps),
        trackingState: TRACKING_STATE[frame.trackingState],
        focalLengthMm: frame.intrinsics?.focalLengthMm ?? parsed.data.intrinsics?.focalLengthMm,
      });
    }
    const samples = [...byFrame.values()].sort((left, right) => left.frame - right.frame);
    if (samples.length === 0) return Promise.reject(new CameraTrackInputError("Mobile session has no frames on the shot clock."));
    const capture: CameraTrackCapture = {
      samples,
      intrinsics: intrinsicsFrom(parsed.data.intrinsics ?? ordered[0]?.intrinsics),
      trackingEvents: trackingEventsForLoss(samples).map((event) => ({
        kind: event.kind,
        frame: event.frame,
        deviceTimestampNs: event.deviceTimestampNs,
      })),
    };
    return Promise.resolve(capture);
  },
});
