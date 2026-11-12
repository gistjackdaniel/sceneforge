import { multiplyQuat, normalizeQuat, rotateVec3, slerpQuat, type Quat, type Vec3 } from "./cameraRotation";
import type { CameraMotionMapping, CameraSample, DeviceCalibration, TrackingEvent, TrackingState } from "./types";

/**
 * A run of `limited` or `not_available` samples.
 * `endFrame` is exclusive and lands on the next normal sample when one exists.
 */
export type TrackingLossInterval = {
  state: "limited" | "not_available";
  startFrame: number;
  endFrame: number;
};

export type ReferenceObservation = {
  frame: number;
  devicePoint: Vec3;
  scenePoint: Vec3;
};

type LayerPose = {
  frame: number;
  position: Vec3;
  rotation: Quat;
  focalLengthMm?: number;
  focusDistanceM?: number;
  aperture?: number;
};

const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: Vec3, factor: number): [number, number, number] => [value[0] * factor, value[1] * factor, value[2] * factor];
const length = (value: Vec3): number => Math.hypot(value[0], value[1], value[2]);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const copyPose = (pose: LayerPose): LayerPose => ({
  ...pose,
  position: [pose.position[0], pose.position[1], pose.position[2]],
  rotation: [pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]],
});

/** Same similarity as `calibrateSamples`. Kept here so this module does not import that file back. */
const scenePoint = (calibration: DeviceCalibration, point: Vec3): [number, number, number] => {
  const rotated = rotateVec3(calibration.rotation, point);
  return add(scale(rotated, calibration.scale), calibration.translation);
};

const scenePose = (calibration: DeviceCalibration, sample: CameraSample): LayerPose => ({
  frame: sample.frame,
  position: scenePoint(calibration, sample.position),
  rotation: multiplyQuat(calibration.rotation, sample.rotation),
  focalLengthMm: sample.focalLengthMm,
  focusDistanceM: sample.focusDistanceM,
  aperture: sample.aperture,
});

const orderedSamples = (samples: readonly CameraSample[]): CameraSample[] =>
  [...samples].sort((left, right) => left.frame - right.frame);

/** Loss intervals on the original samples. The sample list is not modified. */
export const detectTrackingLoss = (samples: readonly CameraSample[]): TrackingLossInterval[] => {
  const ordered = orderedSamples(samples);
  const intervals: TrackingLossInterval[] = [];
  let open: TrackingLossInterval | undefined;
  for (const sample of ordered) {
    const state = sample.trackingState;
    if (state === "limited" || state === "not_available") {
      if (!open || open.state !== state) {
        if (open) intervals.push(open);
        open = { state, startFrame: sample.frame, endFrame: sample.frame + 1 };
      } else {
        open.endFrame = sample.frame + 1;
      }
      continue;
    }
    if (open) {
      open.endFrame = sample.frame;
      intervals.push(open);
      open = undefined;
    }
  }
  if (open) intervals.push(open);
  return intervals;
};

/** Quality log for the intervals. Recovered is written only when tracking returns to normal. */
export const trackingEventsForLoss = (samples: readonly CameraSample[]): TrackingEvent[] => {
  const events: TrackingEvent[] = [];
  for (const interval of detectTrackingLoss(samples)) {
    const start = samples.find((sample) => sample.frame === interval.startFrame);
    events.push({
      kind: "tracking_lost",
      frame: interval.startFrame,
      deviceTimestampNs: start?.deviceTimestampNs,
    });
    const recovered = orderedSamples(samples).find(
      (sample) => sample.frame >= interval.endFrame && sample.trackingState === "normal",
    );
    if (recovered && recovered.frame === interval.endFrame) {
      events.push({
        kind: "tracking_recovered",
        frame: recovered.frame,
        deviceTimestampNs: recovered.deviceTimestampNs,
      });
    }
  }
  return events;
};

const inverseQuat = (quaternion: Quat): [number, number, number, number] => {
  const unit = normalizeQuat(quaternion);
  return [-unit[0], -unit[1], -unit[2], unit[3]];
};

/**
 * Scene-space jump when tracking returns to normal.
 * The correction is the rigid delta that puts the recovered pose back on the
 * predicted one. It is applied later, after calibration, and is not written
 * into the samples. Prediction uses the last two normal samples' velocity.
 */
export const estimateRelocalizationDrift = (
  samples: readonly CameraSample[],
  calibration: DeviceCalibration,
  jumpThresholdM = 0.02,
): TrackingEvent[] => {
  const ordered = orderedSamples(samples);
  const poses = ordered.map((sample) => scenePose(calibration, sample));
  const events: TrackingEvent[] = [];
  const normal: LayerPose[] = [];
  let inLoss = false;
  poses.forEach((pose, index) => {
    const state: TrackingState = ordered[index]?.trackingState ?? "normal";
    if (state !== "normal") {
      inLoss = true;
      return;
    }
    if (inLoss && normal.length > 0) {
      const last = normal[normal.length - 1];
      const previous = normal.length > 1 ? normal[normal.length - 2] : undefined;
      if (!last) return;
      const span = previous ? last.frame - previous.frame : 0;
      const velocity = previous && span !== 0
        ? scale(sub(last.position, previous.position), 1 / span)
        : [0, 0, 0] as [number, number, number];
      const predictedPosition = add(last.position, scale(velocity, pose.frame - last.frame));
      const jump = sub(pose.position, predictedPosition);
      const jumpM = length(jump);
      if (jumpM > jumpThresholdM) {
        const predictedRotation = last.rotation;
        const correctionRotation = multiplyQuat(predictedRotation, inverseQuat(pose.rotation));
        const rotated = rotateVec3(correctionRotation, pose.position);
        const translation: [number, number, number] = sub(predictedPosition, rotated);
        const timestamp = ordered[index]?.deviceTimestampNs;
        events.push({
          kind: "relocalized",
          frame: pose.frame,
          deviceTimestampNs: timestamp,
          estimatedDriftM: jumpM,
        });
        events.push({
          kind: "drift_correction",
          frame: pose.frame,
          deviceTimestampNs: timestamp,
          estimatedDriftM: jumpM,
          correction: { translation, rotation: correctionRotation },
        });
      }
    }
    inLoss = false;
    normal.push(pose);
  });
  return events;
};

/**
 * Drift from seeing the same scene point again.
 * The first observation is the baseline. A later error, minus that baseline,
 * is the drift in scene meters. The correction is a scene-space translation
 * applied from that frame onward.
 */
export const estimateReferenceDrift = (input: {
  calibration: DeviceCalibration;
  observations: readonly ReferenceObservation[];
}): TrackingEvent | undefined => {
  if (input.observations.length < 2) return undefined;
  const ordered = [...input.observations].sort((left, right) => left.frame - right.frame);
  const errorAt = (observation: ReferenceObservation): [number, number, number] =>
    sub(scenePoint(input.calibration, observation.devicePoint), observation.scenePoint);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last || first.frame === last.frame) return undefined;
  const drift = sub(errorAt(last), errorAt(first));
  const estimatedDriftM = length(drift);
  return {
    kind: "drift_correction",
    frame: last.frame,
    estimatedDriftM,
    correction: {
      translation: scale(drift, -1),
      rotation: [0, 0, 0, 1],
    },
  };
};

/**
 * Fill limited and lost poses in the derived list.
 * `preserve` copies the poses through. Samples themselves are not an input.
 */
export const applyLossPolicy = (
  poses: readonly LayerPose[],
  states: readonly TrackingState[],
  policy: CameraMotionMapping["lossPolicy"] = "preserve",
): LayerPose[] => {
  const mode = policy ?? "preserve";
  if (mode === "preserve") return poses.map(copyPose);
  const good = (index: number): boolean => states[index] === "normal";
  return poses.map((pose, index) => {
    if (good(index)) return copyPose(pose);
    let previous = index - 1;
    while (previous >= 0 && !good(previous)) previous -= 1;
    let next = index + 1;
    while (next < poses.length && !good(next)) next += 1;
    if (mode === "hold" || previous < 0 || next >= poses.length) {
      if (previous < 0) return copyPose(pose);
      const held = poses[previous];
      if (!held) return copyPose(pose);
      return { ...copyPose(pose), position: [held.position[0], held.position[1], held.position[2]], rotation: [...held.rotation] };
    }
    const before = poses[previous];
    const after = poses[next];
    if (!before || !after) return copyPose(pose);
    const span = after.frame - before.frame;
    const amount = span === 0 ? 0 : (pose.frame - before.frame) / span;
    return {
      ...copyPose(pose),
      position: lerpVec(before.position, after.position, amount),
      rotation: slerpQuat(before.rotation, after.rotation, amount),
    };
  });
};

/**
 * Scene-space drift layer. Each `drift_correction` replaces the active delta
 * from its frame until the next correction. Turning `enabled` off returns the
 * poses unchanged.
 */
export const applySceneDrift = (
  poses: readonly LayerPose[],
  events: readonly TrackingEvent[] | undefined,
  enabled: boolean,
): LayerPose[] => {
  if (!enabled) return poses.map(copyPose);
  const corrections = (events ?? [])
    .filter((event) => event.kind === "drift_correction" && event.correction)
    .sort((left, right) => left.frame - right.frame);
  return poses.map((pose) => {
    let active: TrackingEvent | undefined;
    for (const event of corrections) {
      if (event.frame <= pose.frame) active = event;
      else break;
    }
    if (!active?.correction) return copyPose(pose);
    const rotation = normalizeQuat(active.correction.rotation);
    const rotated = rotateVec3(rotation, pose.position);
    return {
      ...copyPose(pose),
      position: add(rotated, active.correction.translation),
      rotation: multiplyQuat(rotation, pose.rotation),
    };
  });
};

/** Loss log plus optional drift events, and the mapping flags that apply them. */
export const cameraLayersFromSamples = (input: {
  samples: readonly CameraSample[];
  calibration: DeviceCalibration;
  lossPolicy?: CameraMotionMapping["lossPolicy"];
  applyDriftCorrection?: boolean;
  jumpThresholdM?: number;
  referenceObservations?: readonly ReferenceObservation[];
}): { trackingEvents: TrackingEvent[]; mapping: CameraMotionMapping } => {
  const loss = trackingEventsForLoss(input.samples);
  const jump = estimateRelocalizationDrift(input.samples, input.calibration, input.jumpThresholdM ?? 0.02);
  const reference = input.referenceObservations
    ? estimateReferenceDrift({ calibration: input.calibration, observations: input.referenceObservations })
    : undefined;
  return {
    trackingEvents: reference ? [...loss, ...jump, reference] : [...loss, ...jump],
    mapping: {
      mode: "one_to_one",
      translationGain: [1, 1, 1],
      rotationGain: 1,
      smoothing: 0,
      timeScale: 1,
      timeOffsetFrames: 0,
      lossPolicy: input.lossPolicy ?? "preserve",
      applyDriftCorrection: input.applyDriftCorrection ?? false,
    },
  };
};

/** Path tint for a tracking state. RGB in 0..1. The viewport multiplies nothing else on top. */
export const TRACKING_PATH_COLOR: Record<TrackingState, readonly [number, number, number]> = {
  normal: [0x79 / 255, 0xc0 / 255, 1],
  limited: [0.79, 0.62, 0.16],
  not_available: [0.83, 0.36, 0.29],
};
