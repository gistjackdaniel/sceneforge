import { z } from "zod";
import { frameToTimecode } from "./authoringFps";
import { isPersistentId } from "./persistentId";
import {
  multiplyQuat,
  normalizeQuat,
  rotateVec3,
  slerpQuat,
  type Quat,
  type Vec3,
} from "./cameraRotation";

export type { Quat, Vec3 };

/** Per-sample tracking quality reported by the device, or `normal` for a viewport take. */
export type TrackingState = "normal" | "limited" | "not_available";

/**
 * One original device sample. Mapping and calibration never write back into this list.
 * Viewport recordings are already in scene space and use an identity calibration.
 */
export interface CameraSample {
  frame: number;
  position: Vec3;
  rotation: Quat;
  deviceTimestampNs?: number;
  timecode?: string;
  trackingState: TrackingState;
  focalLengthMm?: number;
  focusDistanceM?: number;
  aperture?: number;
}

/** Pixel K plus the lens data it was built from. K is omitted until an image size is known. */
export interface CameraIntrinsics {
  imageSize?: [number, number];
  K?: [[number, number, number], [number, number, number], [number, number, number]];
  focalLengthMm?: number;
  sensorSizeMm?: [number, number];
  sensorFit?: "horizontal" | "vertical" | "auto";
  /** OpenCV order k1, k2, p1, p2, k3. Kept from the device unchanged. */
  distortion?: [number, number, number, number, number];
}

/**
 * Similarity `T_world_device`. Scene position is `scale * R * p_device + translation`.
 * Scene orientation is `rotation * deviceRotation` (Hamilton product).
 */
export interface DeviceCalibration {
  calibrationId: string;
  arFramework: "arkit" | "arcore" | "webxr" | "viewport" | "other";
  scale: number;
  rotation: Quat;
  translation: Vec3;
  method: "manual_anchor" | "marker" | "plane_fit" | "identity";
  residualRmsM?: number;
  createdAt: string;
}

export interface TrackingEvent {
  kind: "tracking_lost" | "tracking_recovered" | "relocalized" | "drift_correction";
  frame: number;
  deviceTimestampNs?: number;
  correction?: { translation: Vec3; rotation: Quat };
  estimatedDriftM?: number;
}

/**
 * Virtual-camera mapping. Stored beside the original samples.
 * Only `mode` is applied; the other numbers are kept so switching mode does not drop them.
 */
export interface CameraMotionMapping {
  mode: "one_to_one" | "gain" | "smoothing" | "retiming";
  translationGain: Vec3;
  rotationGain: number;
  /** 0 copies the pose. 1 holds the previous pose. */
  smoothing: number;
  timeScale: number;
  timeOffsetFrames: number;
}

export interface VirtualKeyframe {
  frame: number;
  position: Vec3;
  rotation: Quat;
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  easing?: string;
}

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quatSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const mat3Schema = z.tuple([vec3Schema, vec3Schema, vec3Schema]);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optionalFinite = (value: unknown): number | undefined => finiteNumber(value);

const objectRecord = (value: object): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  Object.keys(value).forEach((key) => {
    record[key] = Reflect.get(value, key);
  });
  return record;
};

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
});

const copyVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]];
const copyQuat = (value: Quat): Quat => normalizeQuat([value[0], value[1], value[2], value[3]]);

const asVec3 = (value: unknown): Vec3 | undefined => {
  const parsed = vec3Schema.safeParse(value);
  return parsed.success ? [parsed.data[0], parsed.data[1], parsed.data[2]] : undefined;
};

const asQuat = (value: unknown): Quat | undefined => {
  const parsed = quatSchema.safeParse(value);
  return parsed.success ? normalizeQuat([parsed.data[0], parsed.data[1], parsed.data[2], parsed.data[3]]) : undefined;
};

const trackingStateSchema = z.enum(["normal", "limited", "not_available"]);
const frameworkSchema = z.enum(["arkit", "arcore", "webxr", "viewport", "other"]);
const methodSchema = z.enum(["manual_anchor", "marker", "plane_fit", "identity"]);
const mappingModeSchema = z.enum(["one_to_one", "gain", "smoothing", "retiming"]);
const eventKindSchema = z.enum(["tracking_lost", "tracking_recovered", "relocalized", "drift_correction"]);

/** Device capture accepted from an input adapter. Invalid payloads are rejected, not coerced. */
export const cameraTrackCaptureSchema = z.object({
  authoredFps: z.number().positive(),
  samples: z
    .array(
      z.object({
        frame: z.number().int().nonnegative(),
        position: vec3Schema,
        rotation: quatSchema,
        deviceTimestampNs: z.number().int().nonnegative().optional(),
        timecode: z.string().min(1).optional(),
        trackingState: trackingStateSchema.optional(),
        focalLengthMm: z.number().positive().optional(),
        focusDistanceM: z.number().positive().optional(),
        aperture: z.number().positive().optional(),
      }),
    )
    .min(1),
  intrinsics: z
    .object({
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
    })
    .optional(),
  calibration: z
    .object({
      calibrationId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/),
      arFramework: frameworkSchema,
      scale: z.number().positive(),
      rotation: quatSchema,
      translation: vec3Schema,
      method: methodSchema,
      residualRmsM: z.number().nonnegative().optional(),
      createdAt: z.string().min(1),
    })
    .optional(),
  trackingEvents: z
    .array(
      z.object({
        kind: eventKindSchema,
        frame: z.number().int().nonnegative(),
        deviceTimestampNs: z.number().int().nonnegative().optional(),
        correction: z
          .object({
            translation: vec3Schema,
            rotation: quatSchema,
          })
          .optional(),
        estimatedDriftM: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});

export type CameraTrackCapture = z.infer<typeof cameraTrackCaptureSchema>;

export class CameraTrackInputError extends Error {
  readonly name = "CameraTrackInputError";

  constructor(message: string) {
    super(message);
  }
}

/** Device or fixture source. A real phone adapter can implement this later. */
export interface CameraTrackInputAdapter {
  readonly id: string;
  readCapture(signal?: AbortSignal): Promise<CameraTrackCapture>;
}

/**
 * Read and validate one capture. Does not touch project state.
 * A cancelled signal fails before the adapter is asked to read.
 */
export const readCameraTrackCapture = async (
  adapter: CameraTrackInputAdapter,
  signal?: AbortSignal,
): Promise<CameraTrackCapture> => {
  if (signal?.aborted) {
    throw new CameraTrackInputError("Camera track capture was cancelled.");
  }
  let capture: CameraTrackCapture;
  try {
    capture = await adapter.readCapture(signal);
  } catch (error) {
    if (error instanceof CameraTrackInputError) {
      throw error;
    }
    throw new CameraTrackInputError("Camera track capture failed.");
  }
  const parsed = cameraTrackCaptureSchema.safeParse(capture);
  if (!parsed.success) {
    throw new CameraTrackInputError("Camera track capture did not match the scene contract.");
  }
  return parsed.data;
};

/** In-memory adapter. Used by tests and as the stand-in for a phone that is out of scope. */
export const createFixtureCameraTrackAdapter = (capture: CameraTrackCapture): CameraTrackInputAdapter => ({
  id: "fixture",
  readCapture: (signal) => {
    if (signal?.aborted) {
      return Promise.reject(new CameraTrackInputError("Camera track capture was cancelled."));
    }
    return Promise.resolve(capture);
  },
});

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

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

/**
 * Apply `T_world_device` to original samples. Samples themselves are not modified.
 */
export const calibrateSamples = (samples: CameraSample[], calibration: DeviceCalibration): ScenePose[] => {
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
  if (poses.length === 0) {
    return [];
  }
  const origin = poses[0];
  return poses.map((pose) => ({
    ...pose,
    position: addVec3(origin.position, scaleVec3(subVec3(pose.position, origin.position), mapping.translationGain)),
    rotation: slerpQuat(origin.rotation, pose.rotation, mapping.rotationGain),
  }));
};

const applySmoothing = (poses: ScenePose[], mapping: CameraMotionMapping): ScenePose[] => {
  if (poses.length === 0) {
    return [];
  }
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
    if (frame < 0) {
      return;
    }
    byFrame.set(frame, { ...pose, frame });
  });
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
};

/**
 * Resolve original samples into virtual keyframes.
 * `one_to_one` leaves the calibrated poses unchanged. Other modes do not edit `samples`.
 */
export const resolveVirtualKeyframes = (input: {
  samples: CameraSample[];
  calibration: DeviceCalibration;
  mapping: CameraMotionMapping;
  intrinsics?: CameraIntrinsics;
}): VirtualKeyframe[] => {
  const calibrated = calibrateSamples(input.samples, input.calibration);
  let poses = calibrated;
  if (input.mapping.mode === "gain") {
    poses = applyGain(calibrated, input.mapping);
  } else if (input.mapping.mode === "smoothing") {
    poses = applySmoothing(calibrated, input.mapping);
  } else if (input.mapping.mode === "retiming") {
    poses = applyRetiming(calibrated, input.mapping);
  }
  return poses.map((pose) => ({
    frame: pose.frame,
    position: copyVec3(pose.position),
    rotation: copyQuat(pose.rotation),
    focalLengthMm: pose.focalLengthMm ?? input.intrinsics?.focalLengthMm ?? 35,
    focusDistanceM: pose.focusDistanceM,
    aperture: pose.aperture,
  }));
};

/** Snapshot scene-space keyframes as original samples. Used for manual takes and legacy migration. */
export const samplesFromKeyframes = (
  keyframes: VirtualKeyframe[],
  authoredFps?: number,
): CameraSample[] =>
  [...keyframes]
    .sort((a, b) => a.frame - b.frame)
    .map((keyframe) => ({
      frame: keyframe.frame,
      position: copyVec3(keyframe.position),
      rotation: copyQuat(keyframe.rotation),
      timecode: authoredFps ? frameToTimecode(keyframe.frame, authoredFps) : undefined,
      trackingState: "normal" as const,
      focalLengthMm: keyframe.focalLengthMm,
      focusDistanceM: keyframe.focusDistanceM,
      aperture: keyframe.aperture,
      deviceTimestampNs:
        authoredFps && authoredFps > 0 ? Math.round((keyframe.frame / authoredFps) * 1e9) : undefined,
    }));

const parseIntrinsics = (value: unknown): CameraIntrinsics | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = objectRecord(value);
  const size = z.tuple([z.number().positive(), z.number().positive()]).safeParse(record.imageSize);
  const sensor = z.tuple([z.number().positive(), z.number().positive()]).safeParse(record.sensorSizeMm);
  const matrix = mat3Schema.safeParse(record.K);
  const distortion = z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]).safeParse(record.distortion);
  const sensorFit = z.enum(["horizontal", "vertical", "auto"]).safeParse(record.sensorFit);
  const intrinsics: CameraIntrinsics = {
    imageSize: size.success ? [size.data[0], size.data[1]] : undefined,
    K: matrix.success
      ? [
          [matrix.data[0][0], matrix.data[0][1], matrix.data[0][2]],
          [matrix.data[1][0], matrix.data[1][1], matrix.data[1][2]],
          [matrix.data[2][0], matrix.data[2][1], matrix.data[2][2]],
        ]
      : undefined,
    focalLengthMm: optionalFinite(record.focalLengthMm),
    sensorSizeMm: sensor.success ? [sensor.data[0], sensor.data[1]] : undefined,
    sensorFit: sensorFit.success ? sensorFit.data : undefined,
    distortion: distortion.success
      ? [distortion.data[0], distortion.data[1], distortion.data[2], distortion.data[3], distortion.data[4]]
      : undefined,
  };
  if (
    !intrinsics.imageSize &&
    !intrinsics.K &&
    intrinsics.focalLengthMm === undefined &&
    !intrinsics.sensorSizeMm &&
    !intrinsics.distortion
  ) {
    return undefined;
  }
  return intrinsics;
};

const parseCalibration = (value: unknown): DeviceCalibration => {
  const fallback = identityCalibration();
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = objectRecord(value);
  const rotation = asQuat(record.rotation);
  const translation = asVec3(record.translation);
  const framework = frameworkSchema.safeParse(record.arFramework);
  const method = methodSchema.safeParse(record.method);
  const scale = finiteNumber(record.scale);
  const id = typeof record.calibrationId === "string" && isPersistentId(record.calibrationId)
    ? record.calibrationId
    : fallback.calibrationId;
  return {
    calibrationId: id,
    arFramework: framework.success ? framework.data : fallback.arFramework,
    scale: scale !== undefined && scale > 0 ? scale : fallback.scale,
    rotation: rotation ?? fallback.rotation,
    translation: translation ?? fallback.translation,
    method: method.success ? method.data : fallback.method,
    residualRmsM: optionalFinite(record.residualRmsM),
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : fallback.createdAt,
  };
};

const parseMapping = (value: unknown): CameraMotionMapping => {
  const fallback = identityMapping();
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = objectRecord(value);
  const mode = mappingModeSchema.safeParse(record.mode);
  const gain = asVec3(record.translationGain);
  const rotationGain = finiteNumber(record.rotationGain);
  const smoothing = finiteNumber(record.smoothing);
  const timeScale = finiteNumber(record.timeScale);
  const timeOffset = finiteNumber(record.timeOffsetFrames);
  return {
    mode: mode.success ? mode.data : fallback.mode,
    translationGain: gain ?? fallback.translationGain,
    rotationGain: rotationGain ?? fallback.rotationGain,
    smoothing: smoothing ?? fallback.smoothing,
    timeScale: timeScale ?? fallback.timeScale,
    timeOffsetFrames: timeOffset ?? fallback.timeOffsetFrames,
  };
};

const parseTrackingEvents = (value: unknown): TrackingEvent[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = objectRecord(item);
    const kind = eventKindSchema.safeParse(record.kind);
    const frame = finiteNumber(record.frame);
    if (!kind.success || frame === undefined || frame < 0) {
      return [];
    }
    const correctionValue = record.correction;
    const correctionRecord =
      correctionValue && typeof correctionValue === "object"
        ? objectRecord(correctionValue)
        : undefined;
    const translation = correctionRecord ? asVec3(correctionRecord.translation) : undefined;
    const rotation = correctionRecord ? asQuat(correctionRecord.rotation) : undefined;
    const timestamp = finiteNumber(record.deviceTimestampNs);
    return [
      {
        kind: kind.data,
        frame,
        deviceTimestampNs: timestamp !== undefined && timestamp >= 0 ? Math.round(timestamp) : undefined,
        correction: translation && rotation ? { translation, rotation } : undefined,
        estimatedDriftM: optionalFinite(record.estimatedDriftM),
      },
    ];
  });
};

const parseSample = (value: unknown, migrateQuaternion: (rotation: Quat) => Quat): CameraSample | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = objectRecord(value);
  const frame = finiteNumber(record.frame);
  const position = asVec3(record.position);
  const rotation = asQuat(record.rotation);
  if (frame === undefined || frame < 0 || !position || !rotation) {
    return undefined;
  }
  const state = trackingStateSchema.safeParse(record.trackingState);
  const timestamp = finiteNumber(record.deviceTimestampNs);
  return {
    frame,
    position,
    rotation: migrateQuaternion(rotation),
    deviceTimestampNs: timestamp !== undefined && timestamp >= 0 ? Math.round(timestamp) : undefined,
    timecode: typeof record.timecode === "string" ? record.timecode : undefined,
    trackingState: state.success ? state.data : "normal",
    focalLengthMm: optionalFinite(record.focalLengthMm),
    focusDistanceM: optionalFinite(record.focusDistanceM),
    aperture: optionalFinite(record.aperture),
  };
};

export interface NormalizedStoredTake {
  id: string;
  name: string;
  source: "record" | "manual";
  keyframes: VirtualKeyframe[];
  createdAt: string;
  samples: CameraSample[];
  intrinsics?: CameraIntrinsics;
  calibration: DeviceCalibration;
  trackingEvents: TrackingEvent[];
  mapping: CameraMotionMapping;
  authoredFps?: number;
}

const parseVirtualKeyframe = (
  value: unknown,
  migrateQuaternion: (rotation: Quat) => Quat,
): VirtualKeyframe | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = objectRecord(value);
  const frame = finiteNumber(record.frame);
  const position = asVec3(record.position);
  const rotation = asQuat(record.rotation);
  const focal = finiteNumber(record.focalLengthMm);
  if (frame === undefined || !position || !rotation) {
    return undefined;
  }
  return {
    frame,
    position,
    rotation: migrateQuaternion(rotation),
    focalLengthMm: focal ?? 35,
    focusDistanceM: optionalFinite(record.focusDistanceM),
    aperture: optionalFinite(record.aperture),
    easing: typeof record.easing === "string" ? record.easing : undefined,
  };
};

/**
 * Parse one persisted take. Missing CameraTrack fields are filled from the keyframes
 * (identity calibration, 1:1 mapping) so older saves keep playing.
 * Quaternion migration runs at most once per call, on the raw stored numbers.
 */
export const normalizeStoredTake = (
  value: unknown,
  index: number,
  migrateQuaternion: (rotation: Quat) => Quat,
): NormalizedStoredTake | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = objectRecord(value);
  const keyframes = Array.isArray(record.keyframes)
    ? record.keyframes.flatMap((item) => {
        const parsed = parseVirtualKeyframe(item, migrateQuaternion);
        return parsed ? [parsed] : [];
      })
    : [];
  const samples = Array.isArray(record.samples)
    ? record.samples.flatMap((item) => {
        const parsed = parseSample(item, migrateQuaternion);
        return parsed ? [parsed] : [];
      })
    : [];
  if (keyframes.length === 0 && samples.length === 0) {
    return undefined;
  }
  const authoredFps = optionalFinite(record.authoredFps);
  const resolvedKeyframes =
    keyframes.length > 0
      ? keyframes.sort((a, b) => a.frame - b.frame)
      : resolveVirtualKeyframes({
          samples,
          calibration: parseCalibration(record.calibration),
          mapping: parseMapping(record.mapping),
          intrinsics: parseIntrinsics(record.intrinsics),
        });
  const id = typeof record.id === "string" && isPersistentId(record.id) ? record.id : `take-${index + 1}`;
  return {
    id,
    name: typeof record.name === "string" && record.name ? record.name : `Take ${index + 1}`,
    source: record.source === "record" ? "record" : "manual",
    keyframes: resolvedKeyframes,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    samples:
      samples.length > 0
        ? samples.sort((a, b) => a.frame - b.frame)
        : samplesFromKeyframes(resolvedKeyframes, authoredFps),
    intrinsics: parseIntrinsics(record.intrinsics),
    calibration: parseCalibration(record.calibration),
    trackingEvents: parseTrackingEvents(record.trackingEvents),
    mapping: parseMapping(record.mapping),
    authoredFps: authoredFps && authoredFps > 0 ? authoredFps : undefined,
  };
};
