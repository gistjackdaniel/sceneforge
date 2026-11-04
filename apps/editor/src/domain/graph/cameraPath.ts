import { createCameraTrackId, isPersistentId } from "./persistentId";
import { migrateZyxEncodedQuaternion, normalizeQuat, type Quat } from "./cameraRotation";
import {
  identityCalibration,
  identityMapping,
  normalizeStoredTake,
  resolveVirtualKeyframes,
  samplesFromKeyframes,
  type CameraIntrinsics,
  type CameraMotionMapping,
  type CameraSample,
  type DeviceCalibration,
  type TrackingEvent,
  type VirtualKeyframe,
} from "./cameraTrack";

export type CameraInterpolation = "linear" | "bezier" | "catmull_rom";
export type ScreenDirection = "left_to_right" | "right_to_left" | "neutral";
export type CameraSide = "left" | "right" | "unlocked";
export type {
  CameraIntrinsics,
  CameraMotionMapping,
  CameraSample,
  DeviceCalibration,
  TrackingEvent,
};

export interface CameraContinuityRule {
  /** Human-readable axis such as "Actor A → Actor B". */
  lineOfActionLabel: string;
  /** Stable world element IDs defining the axis orientation. */
  lineActorAId?: string;
  lineActorBId?: string;
  cameraSide: CameraSide;
  screenDirection: ScreenDirection;
}

export interface CameraKeyframe {
  frame: number;
  position: [number, number, number];
  /** GL camera orientation, `[x, y, z, w]`. Not an Euler triple. */
  rotation: [number, number, number, number];
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  easing?: string;
}

export type CameraTakeSource = "record" | "manual";

/** One recorded or manually authored camera trajectory candidate. */
export interface CameraTake {
  id: string;
  name: string;
  source: CameraTakeSource;
  /**
   * Virtual camera in scene space. Viewport playback and Backbone export read this.
   * Recomputed from `samples` when calibration or mapping changes. Manual edits of an
   * identity track update both; a non-identity mapping leaves `samples` untouched.
   */
  keyframes: CameraKeyframe[];
  createdAt: string;
  /** Original samples. Calibration and mapping never overwrite this list. */
  samples: CameraSample[];
  intrinsics?: CameraIntrinsics;
  calibration: DeviceCalibration;
  trackingEvents: TrackingEvent[];
  mapping: CameraMotionMapping;
  /** Rate the samples were stamped with. Playback and export still read `resolveAuthoringFps`. */
  authoredFps?: number;
}

export interface CameraPathParams {
  /**
   * Active take keyframes (mirrored). Generate video and viewport preview read this.
   * Always kept in sync with `takes[activeTakeId]`.
   */
  keyframes: CameraKeyframe[];
  takes: CameraTake[];
  activeTakeId?: string;
  lookAtTargetNodeId?: string;
  /** World element ID — never a display name (PRD look-at). */
  lookAtTargetElementId?: string;
  trackingStrength?: number;
  stabilization?: number;
  interpolation: CameraInterpolation;
  continuity?: CameraContinuityRule;
  label?: string;
  frameCount?: number;
  /**
   * `quaternion_xyzw` means stored rotations are the GL camera quaternion.
   * Absence means they were encoded with the old ZYX formula from XYZ Euler components
   * and must be migrated once.
   */
  rotationStorage?: "quaternion_xyzw";
}

const legacyTakeId = "take-1";

const vec3 = (value: readonly [number, number, number]): [number, number, number] => [
  value[0],
  value[1],
  value[2],
];

const toKeyframe = (keyframe: VirtualKeyframe): CameraKeyframe => ({
  frame: keyframe.frame,
  position: keyframe.position,
  rotation: keyframe.rotation,
  focalLengthMm: keyframe.focalLengthMm,
  focusDistanceM: keyframe.focusDistanceM,
  aperture: keyframe.aperture,
  easing: keyframe.easing,
});

const takeFromNormalized = (normalized: ReturnType<typeof normalizeStoredTake>): CameraTake | undefined => {
  if (!normalized) {
    return undefined;
  }
  return {
    ...normalized,
    keyframes: normalized.keyframes.map(toKeyframe),
  };
};

const identityTakeShell = (
  id: string,
  name: string,
  source: CameraTakeSource,
  createdAt: string,
  authoredFps?: number,
): CameraTake => ({
  id,
  name,
  source,
  keyframes: [],
  createdAt,
  samples: [],
  calibration: identityCalibration(),
  trackingEvents: [],
  mapping: identityMapping(),
  authoredFps,
});

const mirrorsSamples = (take: CameraTake): boolean =>
  take.mapping.mode === "one_to_one" && take.calibration.method === "identity" && take.calibration.scale === 1;

const withTakeKeyframes = (take: CameraTake, keyframes: CameraKeyframe[]): CameraTake => {
  const sorted = sortKeyframes(keyframes);
  return {
    ...take,
    keyframes: sorted,
    samples: mirrorsSamples(take) ? samplesFromKeyframes(sorted, take.authoredFps) : take.samples,
  };
};

const nextTakeNumber = (takes: CameraTake[]): number => {
  const used = takes.map((take) => {
    const match = /^Take (\d+)$/.exec(take.name);
    return match ? Number(match[1]) : 0;
  });
  return Math.max(0, ...used, takes.length) + 1;
};

const allocateTakeId = (takes: CameraTake[], preferred?: string): string => {
  const used = new Set(takes.map((take) => take.id));
  if (preferred && !used.has(preferred) && isPersistentId(preferred)) {
    return preferred;
  }
  let id = createCameraTrackId();
  while (used.has(id)) {
    id = createCameraTrackId();
  }
  return id;
};

const sortKeyframes = (keyframes: CameraKeyframe[]): CameraKeyframe[] =>
  [...keyframes].sort((a, b) => a.frame - b.frame);

const syncActiveKeyframes = (params: CameraPathParams): CameraPathParams => {
  const active = params.takes.find((take) => take.id === params.activeTakeId) ?? params.takes[0];
  const keyframes = active ? sortKeyframes(active.keyframes) : [];
  const lastFrame = keyframes.length > 0 ? keyframes[keyframes.length - 1].frame : 0;
  return {
    ...params,
    activeTakeId: active?.id,
    keyframes,
    frameCount: Math.max(params.frameCount ?? 0, lastFrame),
  };
};

const withActiveTakeKeyframes = (
  params: CameraPathParams,
  keyframes: CameraKeyframe[],
  source: CameraTakeSource = "manual",
  createdAt = new Date().toISOString(),
): CameraPathParams => {
  const sorted = sortKeyframes(keyframes);
  if (params.takes.length === 0 || !params.activeTakeId) {
    const id = allocateTakeId(params.takes);
    const take = withTakeKeyframes(identityTakeShell(id, "Take 1", source, createdAt), sorted);
    return syncActiveKeyframes({
      ...params,
      takes: [take],
      activeTakeId: id,
      rotationStorage: "quaternion_xyzw",
    });
  }
  const takes = params.takes.map((take) =>
    take.id === params.activeTakeId ? withTakeKeyframes(take, sorted) : take,
  );
  return syncActiveKeyframes({ ...params, takes, rotationStorage: "quaternion_xyzw" });
};

export const defaultCameraPathParams = (): CameraPathParams => ({
  keyframes: [],
  takes: [],
  interpolation: "linear",
  stabilization: 0,
  frameCount: 120,
  rotationStorage: "quaternion_xyzw",
});

export const listCameraTakes = (params: CameraPathParams): CameraTake[] => params.takes;

export const activeCameraTake = (params: CameraPathParams): CameraTake | undefined =>
  params.takes.find((take) => take.id === params.activeTakeId) ?? params.takes[0];

export const selectCameraTake = (params: CameraPathParams, takeIdValue: string): CameraPathParams => {
  if (!params.takes.some((take) => take.id === takeIdValue)) {
    return params;
  }
  return syncActiveKeyframes({ ...params, activeTakeId: takeIdValue });
};

export interface CommitCameraTakeInput {
  keyframes: CameraKeyframe[];
  source: CameraTakeSource;
  name?: string;
  createdAt?: string;
  /** Stable id for tests. A collision mints a new `cam_<ULID>` instead of reusing it. */
  id?: string;
  /** Original samples. When present they are the source of truth and keyframes are resolved from them. */
  samples?: CameraSample[];
  intrinsics?: CameraIntrinsics;
  calibration?: DeviceCalibration;
  trackingEvents?: TrackingEvent[];
  mapping?: CameraMotionMapping;
  authoredFps?: number;
}

/**
 * Append a camera track and select it. Does not mutate `params` or the original samples.
 * Viewport and export keep reading `keyframes`, which are the virtual poses after calibration and mapping.
 */
export const commitCameraTake = (
  params: CameraPathParams,
  input: CommitCameraTakeInput,
): CameraPathParams => {
  const calibration = input.calibration
    ? {
        ...input.calibration,
        rotation: normalizeQuat(input.calibration.rotation),
        translation: vec3(input.calibration.translation),
      }
    : identityCalibration();
  const mapping = input.mapping
    ? {
        ...input.mapping,
        translationGain: vec3(input.mapping.translationGain),
      }
    : identityMapping();
  const authoredFps = input.authoredFps;
  const samples =
    input.samples && input.samples.length > 0
      ? [...input.samples].sort((a, b) => a.frame - b.frame).map((sample) => ({
          ...sample,
          position: vec3(sample.position),
          rotation: normalizeQuat(sample.rotation),
        }))
      : samplesFromKeyframes(sortKeyframes(input.keyframes), authoredFps);
  if (samples.length === 0) {
    return params;
  }
  const keyframes = resolveVirtualKeyframes({
    samples,
    calibration,
    mapping,
    intrinsics: input.intrinsics,
  }).map(toKeyframe);
  if (keyframes.length === 0) {
    return params;
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const number = nextTakeNumber(params.takes);
  const id = allocateTakeId(params.takes, input.id);
  const take: CameraTake = {
    id,
    name: input.name ?? `Take ${number}`,
    source: input.source,
    keyframes,
    createdAt,
    samples,
    intrinsics: input.intrinsics,
    calibration,
    trackingEvents: input.trackingEvents ? [...input.trackingEvents] : [],
    mapping,
    authoredFps,
  };
  return syncActiveKeyframes({
    ...params,
    takes: [...params.takes, take],
    activeTakeId: id,
    rotationStorage: "quaternion_xyzw",
  });
};

/**
 * Replace the mapping layer and recompute virtual keyframes. The original `samples` array is kept.
 */
export const withCameraTrackMapping = (
  params: CameraPathParams,
  takeIdValue: string,
  mapping: CameraMotionMapping,
): CameraPathParams => {
  if (!params.takes.some((take) => take.id === takeIdValue)) {
    return params;
  }
  const takes = params.takes.map((take) => {
    if (take.id !== takeIdValue) {
      return take;
    }
    const next: CameraTake = { ...take, mapping };
    return {
      ...next,
      keyframes: resolveVirtualKeyframes(next).map(toKeyframe),
    };
  });
  return syncActiveKeyframes({ ...params, takes, rotationStorage: "quaternion_xyzw" });
};

/**
 * Replace device-to-scene calibration and recompute virtual keyframes. Samples stay as recorded.
 */
export const withDeviceCalibration = (
  params: CameraPathParams,
  takeIdValue: string,
  calibration: DeviceCalibration,
): CameraPathParams => {
  if (!params.takes.some((take) => take.id === takeIdValue)) {
    return params;
  }
  const takes = params.takes.map((take) => {
    if (take.id !== takeIdValue) {
      return take;
    }
    const next: CameraTake = { ...take, calibration };
    return {
      ...next,
      keyframes: resolveVirtualKeyframes(next).map(toKeyframe),
    };
  });
  return syncActiveKeyframes({ ...params, takes, rotationStorage: "quaternion_xyzw" });
};

/**
 * Poses the viewport applies at integer frames. The quaternion is the stored orientation,
 * not an Euler round-trip.
 */
export const viewportPlaybackPoses = (params: CameraPathParams, frameCount: number): CameraKeyframe[] => {
  const count = Math.max(0, Math.floor(frameCount));
  const poses: CameraKeyframe[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    const pose = interpolateCameraPose(params, frame);
    if (pose) {
      poses.push(pose);
    }
  }
  return poses;
};

/**
 * Poses re-derived from the original samples, calibration, and mapping, then interpolated
 * the same way as viewport playback. Does not read the stored virtual keyframes.
 */
export const recordedTakePlaybackPoses = (
  take: CameraTake,
  frameCount: number,
  interpolation: CameraInterpolation = "linear",
): CameraKeyframe[] => {
  const keyframes = resolveVirtualKeyframes(take).map(toKeyframe);
  return viewportPlaybackPoses(
    {
      ...defaultCameraPathParams(),
      keyframes,
      takes: [],
      interpolation,
    },
    frameCount,
  );
};

export const deleteCameraTake = (params: CameraPathParams, takeIdValue: string): CameraPathParams => {
  const takes = params.takes.filter((take) => take.id !== takeIdValue);
  if (takes.length === params.takes.length) {
    return params;
  }
  const activeTakeId =
    params.activeTakeId === takeIdValue ? takes[takes.length - 1]?.id : params.activeTakeId;
  return syncActiveKeyframes({ ...params, takes, activeTakeId });
};

export const upsertCameraKeyframe = (
  params: CameraPathParams,
  keyframe: CameraKeyframe,
): CameraPathParams => {
  const base = params.takes.length === 0 ? withActiveTakeKeyframes(params, [], "manual") : params;
  const without = base.keyframes.filter((item) => item.frame !== keyframe.frame);
  return withActiveTakeKeyframes(base, [...without, keyframe], activeCameraTake(base)?.source ?? "manual");
};

/** One resolved keyframe per frame — inserting on an occupied frame replaces it. */
export const keyframeAtExactFrame = (
  params: CameraPathParams,
  frame: number,
): CameraKeyframe | undefined => params.keyframes.find((item) => item.frame === frame);

export const deleteCameraKeyframe = (params: CameraPathParams, frame: number): CameraPathParams =>
  withActiveTakeKeyframes(
    params,
    params.keyframes.filter((item) => item.frame !== frame),
    activeCameraTake(params)?.source ?? "manual",
  );

export const previousKeyframeFrame = (params: CameraPathParams, frame: number): number | undefined => {
  const sorted = [...params.keyframes].map((item) => item.frame).sort((a, b) => a - b);
  return [...sorted].reverse().find((item) => item < frame);
};

export const nextKeyframeFrame = (params: CameraPathParams, frame: number): number | undefined => {
  const sorted = [...params.keyframes].map((item) => item.frame).sort((a, b) => a - b);
  return sorted.find((item) => item > frame);
};

export const isFrameInsideClip = (frame: number, durationFrames: number): boolean =>
  Number.isFinite(frame) && frame >= 0 && frame < Math.max(1, durationFrames);

export const trimKeyframesToDuration = (
  params: CameraPathParams,
  durationFrames: number,
): { params: CameraPathParams; removed: number } => {
  const kept = params.keyframes.filter((item) => isFrameInsideClip(item.frame, durationFrames));
  const takes = params.takes.map((take) => ({
    ...take,
    keyframes: take.keyframes.filter((item) => isFrameInsideClip(item.frame, durationFrames)),
  }));
  return {
    params: syncActiveKeyframes({
      ...params,
      takes,
      keyframes: kept,
      frameCount: Math.max(0, durationFrames - 1),
    }),
    removed: params.keyframes.length - kept.length,
  };
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const slerpQuat = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] => {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bq: [number, number, number, number] = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  if (dot < 0) {
    dot = -dot;
  }
  if (dot > 0.9995) {
    const mixed: [number, number, number, number] = [
      lerp(a[0], bq[0], t),
      lerp(a[1], bq[1], t),
      lerp(a[2], bq[2], t),
      lerp(a[3], bq[3], t),
    ];
    const mag = Math.hypot(...mixed) || 1;
    return [mixed[0] / mag, mixed[1] / mag, mixed[2] / mag, mixed[3] / mag];
  }
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bq[0] * wb, a[1] * wa + bq[1] * wb, a[2] * wa + bq[2] * wb, a[3] * wa + bq[3] * wb];
};

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * Interpolated pose at frame. Used by Viewport playback; exact frame still wins.
 */
export const interpolateCameraPose = (
  params: CameraPathParams,
  frame: number,
): CameraKeyframe | undefined => {
  const sorted = [...params.keyframes].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) {
    return undefined;
  }
  const exact = sorted.find((item) => item.frame === frame);
  if (exact) {
    return exact;
  }
  if (frame <= sorted[0].frame) {
    return sorted[0];
  }
  const last = sorted[sorted.length - 1];
  if (frame >= last.frame) {
    return last;
  }
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].frame < frame) {
    i += 1;
  }
  const a = sorted[i];
  const b = sorted[i + 1];
  const span = Math.max(1, b.frame - a.frame);
  const t = (frame - a.frame) / span;
  let position = lerpVec3(a.position, b.position, t);
  if (params.interpolation === "catmull_rom") {
    const p0 = sorted[Math.max(0, i - 1)].position;
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)].position;
    position = [
      catmullRom(p0[0], a.position[0], b.position[0], p3[0], t),
      catmullRom(p0[1], a.position[1], b.position[1], p3[1], t),
      catmullRom(p0[2], a.position[2], b.position[2], p3[2], t),
    ];
  }
  return {
    frame,
    position,
    rotation: slerpQuat(a.rotation, b.rotation, t),
    focalLengthMm: lerp(a.focalLengthMm, b.focalLengthMm, t),
    focusDistanceM:
      a.focusDistanceM !== undefined && b.focusDistanceM !== undefined
        ? lerp(a.focusDistanceM, b.focusDistanceM, t)
        : a.focusDistanceM ?? b.focusDistanceM,
    aperture:
      a.aperture !== undefined && b.aperture !== undefined
        ? lerp(a.aperture, b.aperture, t)
        : a.aperture ?? b.aperture,
    easing: a.easing,
  };
};

export const sampleCameraPath = (
  params: CameraPathParams,
  samples = 24,
): Array<[number, number, number]> => {
  if (params.keyframes.length === 0) {
    return [];
  }
  const sorted = [...params.keyframes].sort((a, b) => a.frame - b.frame);
  const start = sorted[0].frame;
  const end = sorted[sorted.length - 1].frame;
  if (end <= start) {
    return [sorted[0].position];
  }
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= samples; i += 1) {
    const frame = start + ((end - start) * i) / samples;
    const pose = interpolateCameraPose(params, frame);
    if (pose) {
      points.push(pose.position);
    }
  }
  return points;
};

export const cameraPoseAtFrame = (
  params: CameraPathParams,
  frame: number,
): CameraKeyframe | undefined => {
  if (params.keyframes.length === 0) {
    return undefined;
  }
  const sorted = [...params.keyframes].sort((a, b) => a.frame - b.frame);
  const exact = sorted.find((item) => item.frame === frame);
  if (exact) {
    return exact;
  }
  const previous = [...sorted].reverse().find((item) => item.frame <= frame);
  return previous ?? sorted[0];
};

const isKeyframeArray = (value: unknown): value is CameraKeyframe[] => Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteTuple = (value: unknown, length: number): number[] | undefined => {
  if (!Array.isArray(value) || value.length !== length) {
    return undefined;
  }
  const numbers: number[] = [];
  for (const item of value) {
    const parsed = finiteNumber(item);
    if (parsed === undefined) {
      return undefined;
    }
    numbers.push(parsed);
  }
  return numbers;
};

const parseTakes = (value: unknown, migrateQuaternion: (rotation: Quat) => Quat): CameraTake[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    const normalized = takeFromNormalized(normalizeStoredTake(item, index, migrateQuaternion));
    return normalized ? [normalized] : [];
  });
};

export const isCameraPathParams = (value: unknown): value is CameraPathParams => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isKeyframeArray(record.keyframes) || Array.isArray(record.takes);
};

export const cameraPathParamsFromNode = (parameters: Record<string, unknown>): CameraPathParams => {
  const continuityValue =
    parameters.continuity && typeof parameters.continuity === "object"
      ? (parameters.continuity as Record<string, unknown>)
      : undefined;
  const continuity: CameraContinuityRule | undefined = continuityValue
    ? {
        lineOfActionLabel:
          typeof continuityValue.lineOfActionLabel === "string"
            ? continuityValue.lineOfActionLabel
            : "",
        lineActorAId:
          typeof continuityValue.lineActorAId === "string"
            ? continuityValue.lineActorAId
            : undefined,
        lineActorBId:
          typeof continuityValue.lineActorBId === "string"
            ? continuityValue.lineActorBId
            : undefined,
        cameraSide:
          continuityValue.cameraSide === "left" ||
          continuityValue.cameraSide === "right" ||
          continuityValue.cameraSide === "unlocked"
            ? continuityValue.cameraSide
            : "unlocked",
        screenDirection:
          continuityValue.screenDirection === "left_to_right" ||
          continuityValue.screenDirection === "right_to_left" ||
          continuityValue.screenDirection === "neutral"
            ? continuityValue.screenDirection
            : "neutral",
      }
    : undefined;

  const shared = {
    lookAtTargetNodeId:
      typeof parameters.lookAtTargetNodeId === "string" ? parameters.lookAtTargetNodeId : undefined,
    lookAtTargetElementId:
      typeof parameters.lookAtTargetElementId === "string" ? parameters.lookAtTargetElementId : undefined,
    trackingStrength:
      typeof parameters.trackingStrength === "number"
        ? parameters.trackingStrength
        : typeof parameters.stabilization === "number"
          ? parameters.stabilization
          : undefined,
    stabilization: typeof parameters.stabilization === "number" ? parameters.stabilization : undefined,
    interpolation:
      parameters.interpolation === "bezier" || parameters.interpolation === "catmull_rom"
        ? parameters.interpolation
        : ("linear" as CameraInterpolation),
    continuity,
    label: typeof parameters.label === "string" ? parameters.label : undefined,
    frameCount: typeof parameters.frameCount === "number" ? parameters.frameCount : 120,
  };

  const trustQuaternion = parameters.rotationStorage === "quaternion_xyzw";
  const migrateQuaternion = (rotation: Quat): Quat =>
    trustQuaternion ? normalizeQuat(rotation) : migrateZyxEncodedQuaternion(rotation);
  const parsedTakes = parseTakes(parameters.takes, migrateQuaternion);
  const legacyKeys = isKeyframeArray(parameters.keyframes)
    ? parameters.keyframes.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const frame = finiteNumber(Reflect.get(item, "frame"));
        const position = finiteTuple(Reflect.get(item, "position"), 3);
        const rotation = finiteTuple(Reflect.get(item, "rotation"), 4);
        const focalLengthMm = finiteNumber(Reflect.get(item, "focalLengthMm"));
        if (frame === undefined || !position || !rotation) {
          return [];
        }
        const easingValue = Reflect.get(item, "easing");
        const keyframe: CameraKeyframe = {
          frame,
          position: [position[0], position[1], position[2]],
          rotation: migrateQuaternion([rotation[0], rotation[1], rotation[2], rotation[3]]),
          focalLengthMm: focalLengthMm ?? 35,
          focusDistanceM: finiteNumber(Reflect.get(item, "focusDistanceM")),
          aperture: finiteNumber(Reflect.get(item, "aperture")),
          easing: typeof easingValue === "string" ? easingValue : undefined,
        };
        return [keyframe];
      })
    : [];

  if (parsedTakes.length > 0) {
    const activeTakeId =
      typeof parameters.activeTakeId === "string" &&
      parsedTakes.some((take) => take.id === parameters.activeTakeId)
        ? parameters.activeTakeId
        : parsedTakes[0].id;
    return syncActiveKeyframes({
      ...defaultCameraPathParams(),
      ...shared,
      takes: parsedTakes,
      activeTakeId,
      rotationStorage: "quaternion_xyzw",
    });
  }

  if (legacyKeys.length > 0) {
    const sorted = sortKeyframes(legacyKeys);
    const take = withTakeKeyframes(
      identityTakeShell(legacyTakeId, "Take 1", "manual", new Date(0).toISOString()),
      sorted,
    );
    return syncActiveKeyframes({
      ...defaultCameraPathParams(),
      ...shared,
      takes: [take],
      activeTakeId: legacyTakeId,
      rotationStorage: "quaternion_xyzw",
    });
  }

  return {
    ...defaultCameraPathParams(),
    ...shared,
    rotationStorage: "quaternion_xyzw",
  };
};
