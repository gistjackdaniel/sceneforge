export type CameraInterpolation = "linear" | "bezier" | "catmull_rom";
export type ScreenDirection = "left_to_right" | "right_to_left" | "neutral";
export type CameraSide = "left" | "right" | "unlocked";

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
  rotation: [number, number, number, number];
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  easing?: string;
}

export interface CameraPathParams {
  keyframes: CameraKeyframe[];
  lookAtTargetNodeId?: string;
  /** World element ID — never a display name (PRD look-at). */
  lookAtTargetElementId?: string;
  trackingStrength?: number;
  stabilization?: number;
  interpolation: CameraInterpolation;
  continuity?: CameraContinuityRule;
  label?: string;
  frameCount?: number;
}

export const defaultCameraPathParams = (): CameraPathParams => ({
  keyframes: [],
  interpolation: "linear",
  stabilization: 0,
  frameCount: 120,
});

export const upsertCameraKeyframe = (
  params: CameraPathParams,
  keyframe: CameraKeyframe,
): CameraPathParams => {
  const without = params.keyframes.filter((item) => item.frame !== keyframe.frame);
  const keyframes = [...without, keyframe].sort((a, b) => a.frame - b.frame);
  const lastFrame = keyframes.length > 0 ? keyframes[keyframes.length - 1].frame : 0;
  return {
    ...params,
    keyframes,
    frameCount: Math.max(params.frameCount ?? 0, lastFrame),
  };
};

/** One resolved keyframe per frame — inserting on an occupied frame replaces it. */
export const keyframeAtExactFrame = (
  params: CameraPathParams,
  frame: number,
): CameraKeyframe | undefined => params.keyframes.find((item) => item.frame === frame);

export const deleteCameraKeyframe = (params: CameraPathParams, frame: number): CameraPathParams => ({
  ...params,
  keyframes: params.keyframes.filter((item) => item.frame !== frame),
});

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
  return {
    params: { ...params, keyframes: kept, frameCount: Math.max(0, durationFrames - 1) },
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

export const isCameraPathParams = (value: unknown): value is CameraPathParams => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.keyframes);
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
  if (isCameraPathParams(parameters) && parameters.keyframes.length > 0) {
    return {
      keyframes: parameters.keyframes,
      lookAtTargetNodeId: parameters.lookAtTargetNodeId,
      lookAtTargetElementId:
        typeof parameters.lookAtTargetElementId === "string" ? parameters.lookAtTargetElementId : undefined,
      trackingStrength:
        typeof parameters.trackingStrength === "number"
          ? parameters.trackingStrength
          : parameters.stabilization,
      stabilization: parameters.stabilization,
      interpolation: parameters.interpolation ?? "linear",
      continuity,
      label: parameters.label,
      frameCount: parameters.frameCount,
    };
  }
  return {
    ...defaultCameraPathParams(),
    continuity,
    label: typeof parameters.label === "string" ? parameters.label : undefined,
    frameCount: typeof parameters.frameCount === "number" ? parameters.frameCount : 120,
  };
};
