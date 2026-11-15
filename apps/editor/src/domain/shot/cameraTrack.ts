import { z } from "zod";
import { frameToTimecode } from "./timecode";
import {
  multiplyQuat,
  normalizeQuat,
  rotateVec3,
  slerpQuat,
  type Quat,
  type Vec3,
} from "./cameraRotation";
import { applyLossPolicy, applySceneDrift } from "./trackingContinuity";
import type { CameraIntrinsics, CameraKey, CameraMotionMapping, CameraSample, DeviceCalibration, TrackingEvent } from "./types";

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quatSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const mat3Schema = z.tuple([vec3Schema, vec3Schema, vec3Schema]);

const copyVec3 = (value: readonly number[]): Vec3 => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
const copyQuat = (value: readonly number[]): Quat => normalizeQuat(value);

export const identityCalibration = (): DeviceCalibration => ({
  calibrationId: "cal_identity",
  arFramework: "viewport",
  scale: 1,
  rotation: [0, 0, 0, 1],
  translation: [0, 0, 0],
  method: "identity",
  createdAt: "1970-01-01T00:00:00.000Z",
});

export const identityMapping = (): CameraMotionMapping => ({
  mode: "one_to_one",
  translationGain: [1, 1, 1],
  rotationGain: 1,
  smoothing: 0,
  timeScale: 1,
  timeOffsetFrames: 0,
  lossPolicy: "preserve",
  applyDriftCorrection: false,
});

/** True when virtual keys are the calibrated samples with no extra motion mapping. */
export const mirrorsSamples = (input: {
  mapping: CameraMotionMapping;
  calibration: DeviceCalibration;
}): boolean =>
  input.mapping.mode === "one_to_one"
  && (input.mapping.lossPolicy ?? "preserve") === "preserve"
  && input.mapping.applyDriftCorrection !== true
  && input.calibration.method === "identity"
  && input.calibration.scale === 1;

const trackingStateSchema = z.enum(["normal", "limited", "not_available"]);
const frameworkSchema = z.enum(["arkit", "arcore", "webxr", "viewport", "other"]);
const methodSchema = z.enum(["manual_anchor", "marker", "plane_fit", "identity"]);
const eventKindSchema = z.enum(["tracking_lost", "tracking_recovered", "relocalized", "drift_correction"]);

/** Device or fixture capture. It does not carry a frame rate; the shot's `time.fps` is the only clock. */
export const cameraTrackCaptureSchema = z.object({
  samples: z.array(z.object({
    frame: z.number().int().nonnegative(),
    position: vec3Schema,
    rotation: quatSchema,
    deviceTimestampNs: z.number().int().nonnegative().optional(),
    timecode: z.string().min(1).optional(),
    trackingState: trackingStateSchema.optional(),
    focalLengthMm: z.number().positive().optional(),
    focusDistanceM: z.number().positive().optional(),
    aperture: z.number().positive().optional(),
  })).min(1),
  intrinsics: z.object({
    imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    K: mat3Schema.optional(),
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
  }).optional(),
  calibration: z.object({
    calibrationId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/),
    arFramework: frameworkSchema,
    scale: z.number().positive(),
    rotation: quatSchema,
    translation: vec3Schema,
    method: methodSchema,
    residualRmsM: z.number().nonnegative().optional(),
    createdAt: z.string().min(1),
  }).optional(),
  trackingEvents: z.array(z.object({
    kind: eventKindSchema,
    frame: z.number().int().nonnegative(),
    deviceTimestampNs: z.number().int().nonnegative().optional(),
    correction: z.object({
      translation: vec3Schema,
      rotation: quatSchema,
    }).optional(),
    estimatedDriftM: z.number().nonnegative().optional(),
  })).optional(),
});

export type CameraTrackCapture = z.infer<typeof cameraTrackCaptureSchema>;

export class CameraTrackInputError extends Error {
  readonly name = "CameraTrackInputError";

  constructor(message: string) {
    super(message);
  }
}

/** Device or fixture source. A phone adapter can implement this later. This one does not open a device. */
export interface CameraTrackInputAdapter {
  readonly id: string;
  readCapture(signal?: AbortSignal): Promise<CameraTrackCapture>;
}

/** Read and validate one capture. Does not touch project state. */
export const readCameraTrackCapture = async (
  adapter: CameraTrackInputAdapter,
  signal?: AbortSignal,
): Promise<CameraTrackCapture> => {
  if (signal?.aborted) throw new CameraTrackInputError("Camera track capture was cancelled.");
  let capture: CameraTrackCapture;
  try {
    capture = await adapter.readCapture(signal);
  } catch (error) {
    if (error instanceof CameraTrackInputError) throw error;
    throw new CameraTrackInputError("Camera track capture failed.");
  }
  const parsed = cameraTrackCaptureSchema.safeParse(capture);
  if (!parsed.success) throw new CameraTrackInputError("Camera track capture did not match the scene contract.");
  return parsed.data;
};

/** In-memory adapter for tests. Stands in for a phone, which is out of scope. */
export const createFixtureCameraTrackAdapter = (capture: CameraTrackCapture): CameraTrackInputAdapter => ({
  id: "fixture",
  readCapture: (signal) => {
    if (signal?.aborted) return Promise.reject(new CameraTrackInputError("Camera track capture was cancelled."));
    return Promise.resolve(capture);
  },
});

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scaleVec3 = (value: Vec3, gain: Vec3): Vec3 => [value[0] * gain[0], value[1] * gain[1], value[2] * gain[2]];
const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

interface ScenePose {
  frame: number;
  position: Vec3;
  rotation: Quat;
  focalLengthMm?: number;
  focusDistanceM?: number;
  aperture?: number;
}

/** Apply `T_world_device`. The sample list is not modified. */
export const calibrateSamples = (samples: readonly CameraSample[], calibration: DeviceCalibration): ScenePose[] => {
  const rotation = copyQuat(calibration.rotation);
  const translation = copyVec3(calibration.translation);
  const scale = calibration.scale;
  return samples.map((sample) => ({
    frame: sample.frame,
    position: addVec3(scaleVec3(rotateVec3(rotation, sample.position), [scale, scale, scale]), translation),
    rotation: multiplyQuat(rotation, sample.rotation),
    focalLengthMm: sample.focalLengthMm,
    focusDistanceM: sample.focusDistanceM,
    aperture: sample.aperture,
  }));
};

const applyGain = (poses: ScenePose[], mapping: CameraMotionMapping): ScenePose[] => {
  if (poses.length === 0) return [];
  const origin = poses[0];
  return poses.map((pose) => ({
    ...pose,
    position: addVec3(origin.position, scaleVec3(subVec3(pose.position, origin.position), mapping.translationGain)),
    rotation: slerpQuat(origin.rotation, pose.rotation, mapping.rotationGain),
  }));
};

const applySmoothing = (poses: ScenePose[], mapping: CameraMotionMapping): ScenePose[] => {
  if (poses.length === 0) return [];
  const alpha = 1 - Math.min(1, Math.max(0, mapping.smoothing));
  const smoothed: ScenePose[] = [];
  let position = copyVec3(poses[0].position);
  let rotation = copyQuat(poses[0].rotation);
  poses.forEach((pose, index) => {
    if (index > 0) {
      position = lerpVec3(position, pose.position, alpha);
      rotation = slerpQuat(rotation, pose.rotation, alpha);
    }
    smoothed.push({ ...pose, position: copyVec3(position), rotation: copyQuat(rotation) });
  });
  return smoothed;
};

const applyRetiming = (poses: ScenePose[], mapping: CameraMotionMapping): ScenePose[] => {
  const byFrame = new Map<number, ScenePose>();
  poses.forEach((pose) => {
    const frame = Math.round(pose.frame * mapping.timeScale + mapping.timeOffsetFrames);
    if (frame < 0) return;
    byFrame.set(frame, { ...pose, frame });
  });
  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
};

/**
 * Resolve original samples into virtual camera keys.
 * Order: calibration, tracking-loss fill, drift correction, then motion mapping.
 * None of those steps write back into `samples`.
 */
export const resolveVirtualKeyframes = (input: {
  samples: readonly CameraSample[];
  calibration: DeviceCalibration;
  mapping: CameraMotionMapping;
  intrinsics?: CameraIntrinsics;
  trackingEvents?: readonly TrackingEvent[];
}): CameraKey[] => {
  const ordered = [...input.samples].sort((left, right) => left.frame - right.frame);
  const calibrated = calibrateSamples(ordered, input.calibration);
  const filled = applyLossPolicy(calibrated, ordered.map((sample) => sample.trackingState), input.mapping.lossPolicy ?? "preserve");
  const corrected = applySceneDrift(filled, input.trackingEvents, input.mapping.applyDriftCorrection === true);
  let poses = corrected;
  if (input.mapping.mode === "gain") poses = applyGain(corrected, input.mapping);
  else if (input.mapping.mode === "smoothing") poses = applySmoothing(corrected, input.mapping);
  else if (input.mapping.mode === "retiming") poses = applyRetiming(corrected, input.mapping);
  return poses.map((pose) => ({
    frame: pose.frame,
    position: copyVec3(pose.position),
    rotation: copyQuat(pose.rotation),
    focalLengthMm: pose.focalLengthMm ?? input.intrinsics?.focalLengthMm ?? 35,
    focusDistanceM: pose.focusDistanceM,
    aperture: pose.aperture,
  }));
};

/**
 * Snapshot scene-space keys as original samples.
 * `fps` is `Shot.time.fps` and is not stored on the sample as a second rate.
 */
export const samplesFromKeyframes = (keyframes: readonly CameraKey[], fps: number): CameraSample[] =>
  [...keyframes]
    .sort((left, right) => left.frame - right.frame)
    .map((keyframe) => ({
      frame: keyframe.frame,
      position: copyVec3(keyframe.position),
      rotation: copyQuat(keyframe.rotation),
      timecode: frameToTimecode(keyframe.frame, fps),
      trackingState: "normal" as const,
      focalLengthMm: keyframe.focalLengthMm,
      focusDistanceM: keyframe.focusDistanceM,
      aperture: keyframe.aperture,
      deviceTimestampNs: Math.round((keyframe.frame / fps) * 1e9),
    }));
