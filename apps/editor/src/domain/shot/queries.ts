import { resolveVirtualKeyframes } from "./cameraTrack";
import type { CameraInterpolation, CameraKey, CameraTake, Quat, Shot, ShotCamera, Transform, Vec3 } from "./types";

/** The only frame rate recording and export may read. */
export const readShotTimeFps = (shot: Pick<Shot, "time">): number => {
  const fps = shot.time.fps;
  if (!(typeof fps === "number" && Number.isFinite(fps) && fps > 0)) {
    throw new Error("Shot time.fps is required.");
  }
  return fps;
};

export const selectedTake = (shot: Shot): CameraTake | undefined => {
  if (shot.camera.status !== "ready") return undefined;
  const selectedId = shot.camera.selectedTakeId;
  return shot.camera.takes.find((take) => take.id === selectedId);
};

export const hasSelectedTake = (shot: Shot): shot is Shot & { camera: Extract<ShotCamera, { status: "ready" }> } => {
  const camera = shot.camera;
  return camera.status === "ready" && camera.takes.some((take) => take.id === camera.selectedTakeId);
};

const clamp = (frame: number, duration: number) => Math.max(0, Math.min(duration - 1, frame));

const mix = (start: number, end: number, amount: number) => start + (end - start) * amount;

const mixVec = (start: Vec3, end: Vec3, amount: number): Vec3 => [
  mix(start[0], end[0], amount),
  mix(start[1], end[1], amount),
  mix(start[2], end[2], amount),
];

const slerp = (start: Quat, end: Quat, amount: number): Quat => {
  let bx = end[0];
  let by = end[1];
  let bz = end[2];
  let bw = end[3];
  let dot = start[0] * bx + start[1] * by + start[2] * bz + start[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const mixed: Quat = [
      mix(start[0], bx, amount),
      mix(start[1], by, amount),
      mix(start[2], bz, amount),
      mix(start[3], bw, amount),
    ];
    const length = Math.hypot(mixed[0], mixed[1], mixed[2], mixed[3]) || 1;
    return [mixed[0] / length, mixed[1] / length, mixed[2] / length, mixed[3] / length];
  }
  const theta = Math.acos(Math.min(1, dot));
  const scaleStart = Math.sin((1 - amount) * theta) / Math.sin(theta);
  const scaleEnd = Math.sin(amount * theta) / Math.sin(theta);
  return [
    start[0] * scaleStart + bx * scaleEnd,
    start[1] * scaleStart + by * scaleEnd,
    start[2] * scaleStart + bz * scaleEnd,
    start[3] * scaleStart + bw * scaleEnd,
  ];
};

const catmull = (p0: number, p1: number, p2: number, p3: number, amount: number) => {
  const amount2 = amount * amount;
  const amount3 = amount2 * amount;
  return 0.5 * ((2 * p1) + (-p0 + p2) * amount + (2 * p0 - 5 * p1 + 4 * p2 - p3) * amount2 + (-p0 + 3 * p1 - 3 * p2 + p3) * amount3);
};

const catmullVec = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, amount: number): Vec3 => [
  catmull(p0[0], p1[0], p2[0], p3[0], amount),
  catmull(p0[1], p1[1], p2[1], p3[1], amount),
  catmull(p0[2], p1[2], p2[2], p3[2], amount),
];

export const sampleCameraPose = (
  take: CameraTake,
  frame: number,
  interpolation: CameraInterpolation,
): { position: Vec3; rotation: Quat; focalLengthMm: number; focusDistanceM?: number; aperture?: number } => {
  const keys = [...take.keys].sort((left, right) => left.frame - right.frame);
  const first = keys[0];
  if (keys.length === 1 || frame <= first.frame) return first;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last;
  const after = keys.findIndex((key) => key.frame > frame);
  const right = keys[after];
  const left = keys[after - 1];
  const amount = (frame - left.frame) / (right.frame - left.frame);
  const position = interpolation === "catmull_rom"
    ? catmullVec(keys[Math.max(0, after - 2)].position, left.position, right.position, keys[Math.min(keys.length - 1, after + 1)].position, amount)
    : mixVec(left.position, right.position, amount);
  return {
    position,
    rotation: slerp(left.rotation, right.rotation, amount),
    focalLengthMm: left.focalLengthMm,
    focusDistanceM: left.focusDistanceM,
    aperture: left.aperture,
  };
};

export const sampleSubjectPose = (subject: Shot["subjects"][number], frame: number): Transform => {
  if (subject.kind === "light" || subject.motion.channel !== "explicit") return subject.placement;
  const keys = [...subject.motion.keys].sort((left, right) => left.frame - right.frame);
  const first = keys[0];
  if (frame <= first.frame) return first;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last;
  const after = keys.findIndex((key) => key.frame > frame);
  const right = keys[after];
  const left = keys[after - 1];
  if (subject.motion.interpolation === "hold") return left;
  const amount = (frame - left.frame) / (right.frame - left.frame);
  return {
    position: mixVec(left.position, right.position, amount),
    rotationEuler: [
      mix(left.rotationEuler[0], right.rotationEuler[0], amount),
      mix(left.rotationEuler[1], right.rotationEuler[1], amount),
      mix(left.rotationEuler[2], right.rotationEuler[2], amount),
    ],
    scale: mixVec(left.scale, right.scale, amount),
  };
};

export const subjectPoseKeys = (subject: Shot["subjects"][number]): readonly number[] =>
  subject.kind === "light" || subject.motion.channel !== "explicit" ? [] : subject.motion.keys.map((key) => key.frame);

const nonemptyKeys = (keys: readonly CameraKey[]): CameraTake["keys"] | undefined =>
  keys.length > 0 ? [keys[0], ...keys.slice(1)] : undefined;

/** Viewport playback from the stored virtual keys. */
export const viewportPlaybackPoses = (shot: Shot, frameCount: number): ReturnType<typeof sampleCameraPose>[] => {
  const take = selectedTake(shot);
  if (!take || shot.camera.status !== "ready") return [];
  const count = Math.max(0, Math.floor(frameCount));
  const interpolation = shot.camera.interpolation;
  return Array.from({ length: count }, (_, frame) => sampleCameraPose(take, frame, interpolation));
};

/**
 * Playback re-derived from the original samples, calibration, and mapping.
 * Does not read the stored virtual keys, so a mapping change cannot hide a rewritten sample.
 */
export const recordedTakePlaybackPoses = (shot: Shot, frameCount: number, take: CameraTake | undefined = selectedTake(shot)): ReturnType<typeof sampleCameraPose>[] => {
  if (!take || shot.camera.status !== "ready") return [];
  const keys = nonemptyKeys(resolveVirtualKeyframes(take));
  if (!keys) return [];
  const virtual: CameraTake = { ...take, keys };
  const count = Math.max(0, Math.floor(frameCount));
  const interpolation = shot.camera.interpolation;
  return Array.from({ length: count }, (_, frame) => sampleCameraPose(virtual, frame, interpolation));
};

export const sampleCameraPathPositions = (shot: Shot, count = 64): Vec3[] => {
  const take = selectedTake(shot);
  if (!take || shot.camera.status !== "ready") return [];
  const interpolation = shot.camera.interpolation;
  const end = Math.max(take.keys[take.keys.length - 1]?.frame ?? 0, 1);
  return Array.from({ length: count }, (_, index) =>
    sampleCameraPose(take, (end * index) / Math.max(1, count - 1), interpolation).position);
};

export const clipLocalFrame = (playhead: number, shot: Shot) =>
  clamp(Math.round(playhead), shot.time.durationFrames);

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
};

const fnv = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** Ignores display names, take names, and render receipts. */
export const generateHash = (shot: Shot): string => {
  const take = selectedTake(shot);
  const body = {
    time: shot.time,
    environment: shot.environment?.worldId ?? null,
    subjects: shot.subjects.map((subject) => {
      if (subject.kind === "light") {
        return { assetId: subject.assetId, assetVersion: subject.assetVersion, uri: subject.uri, kind: subject.kind, placement: subject.placement, intensity: subject.intensity, color: subject.color };
      }
      return {
        assetId: subject.assetId,
        assetVersion: subject.assetVersion,
        uri: subject.uri,
        kind: subject.kind,
        representation: subject.representation,
        placement: subject.placement,
        motion: subject.motion,
      };
    }),
    camera: take
      ? {
          interpolation: shot.camera.interpolation,
          lens: shot.camera.lens,
          takeId: take.id,
          keys: take.keys,
          samples: take.samples,
          calibration: take.calibration,
          mapping: take.mapping,
          intrinsics: take.intrinsics ?? null,
          trackingEvents: take.trackingEvents,
        }
      : { interpolation: shot.camera.interpolation, lens: shot.camera.lens, takeId: null },
  };
  return fnv(JSON.stringify(stable(body)));
};
