import { frameToTimecode } from "../../domain/shot/timecode";
import { identityCalibration, identityMapping, type CameraTrackCapture } from "../../domain/shot/cameraTrack";
import { SENSOR_SIZE_MM, type SensorPreset } from "../../domain/graph/lens";
import { normalizeQuat } from "../../domain/shot/cameraRotation";
import type { CameraKey, CameraSample, DeviceCalibration, Lens, ShotCommand } from "../../domain/shot";

export interface ViewportPoseSample {
  frame: number;
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
}

const sensorPreset = (value: string | undefined): SensorPreset =>
  value === "super35" || value === "micro-four-thirds" ? value : "full-frame";

/**
 * Turn viewport samples into a scene-space capture.
 * The viewport is already in the scene frame, so calibration stays identity.
 * `fps` is `Shot.time.fps`.
 */
export const viewportCaptureFromPoses = (input: {
  poses: readonly ViewportPoseSample[];
  fps: number;
  lens: Lens;
}): CameraTrackCapture => {
  const sensor = SENSOR_SIZE_MM[sensorPreset(input.lens.sensorPreset)];
  const samples = [...input.poses]
    .sort((left, right) => left.frame - right.frame)
    .map((pose) => {
      const frame = Math.max(0, Math.round(pose.frame));
      return {
        frame,
        position: [pose.position[0], pose.position[1], pose.position[2]] as [number, number, number],
        rotation: normalizeQuat(pose.quaternion),
        deviceTimestampNs: Math.round((frame / input.fps) * 1e9),
        timecode: frameToTimecode(frame, input.fps),
        trackingState: "normal" as const,
        focalLengthMm: input.lens.focalLengthMm,
        focusDistanceM: input.lens.focusDistanceM,
        aperture: input.lens.aperture,
      };
    });
  const calibration = identityCalibration();
  return {
    samples,
    calibration: {
      calibrationId: calibration.calibrationId,
      arFramework: calibration.arFramework,
      scale: calibration.scale,
      rotation: [calibration.rotation[0], calibration.rotation[1], calibration.rotation[2], calibration.rotation[3]],
      translation: [calibration.translation[0], calibration.translation[1], calibration.translation[2]],
      method: calibration.method,
      residualRmsM: calibration.residualRmsM,
      createdAt: calibration.createdAt,
    },
    intrinsics: {
      focalLengthMm: input.lens.focalLengthMm,
      sensorSizeMm: sensor,
      sensorFit: "horizontal",
    },
    trackingEvents: [],
  };
};

type CommitFields = Pick<Extract<ShotCommand, { type: "COMMIT_CAMERA_TAKE" }>, "keys" | "samples" | "intrinsics" | "calibration" | "trackingEvents" | "mapping">;

/** Copy a validated capture into the shot commit fields. Original sample numbers are kept. */
export const commitFieldsFromCapture = (capture: CameraTrackCapture): CommitFields => {
  const calibration: DeviceCalibration = capture.calibration
    ? {
        calibrationId: capture.calibration.calibrationId,
        arFramework: capture.calibration.arFramework,
        scale: capture.calibration.scale,
        rotation: normalizeQuat(capture.calibration.rotation),
        translation: [capture.calibration.translation[0], capture.calibration.translation[1], capture.calibration.translation[2]],
        method: capture.calibration.method,
        residualRmsM: capture.calibration.residualRmsM,
        createdAt: capture.calibration.createdAt,
      }
    : identityCalibration();
  const samples: CameraSample[] = capture.samples.map((sample) => ({
    frame: sample.frame,
    position: [sample.position[0], sample.position[1], sample.position[2]],
    rotation: normalizeQuat(sample.rotation),
    deviceTimestampNs: sample.deviceTimestampNs,
    timecode: sample.timecode,
    trackingState: sample.trackingState ?? "normal",
    focalLengthMm: sample.focalLengthMm,
    focusDistanceM: sample.focusDistanceM,
    aperture: sample.aperture,
  }));
  const keys: [CameraKey, ...CameraKey[]] = samples.map((sample) => ({
    frame: sample.frame,
    position: sample.position,
    rotation: sample.rotation,
    focalLengthMm: sample.focalLengthMm ?? capture.intrinsics?.focalLengthMm ?? 35,
    focusDistanceM: sample.focusDistanceM,
    aperture: sample.aperture,
  })) as [CameraKey, ...CameraKey[]];
  return {
    keys,
    samples,
    intrinsics: capture.intrinsics
      ? {
          imageSize: capture.intrinsics.imageSize
            ? [capture.intrinsics.imageSize[0], capture.intrinsics.imageSize[1]]
            : undefined,
          K: capture.intrinsics.K
            ? [
                [capture.intrinsics.K[0][0], capture.intrinsics.K[0][1], capture.intrinsics.K[0][2]],
                [capture.intrinsics.K[1][0], capture.intrinsics.K[1][1], capture.intrinsics.K[1][2]],
                [capture.intrinsics.K[2][0], capture.intrinsics.K[2][1], capture.intrinsics.K[2][2]],
              ]
            : undefined,
          focalLengthMm: capture.intrinsics.focalLengthMm,
          sensorSizeMm: capture.intrinsics.sensorSizeMm
            ? [capture.intrinsics.sensorSizeMm[0], capture.intrinsics.sensorSizeMm[1]]
            : undefined,
          sensorFit: capture.intrinsics.sensorFit,
          distortion: capture.intrinsics.distortion
            ? [
                capture.intrinsics.distortion[0],
                capture.intrinsics.distortion[1],
                capture.intrinsics.distortion[2],
                capture.intrinsics.distortion[3],
                capture.intrinsics.distortion[4],
              ]
            : undefined,
        }
      : undefined,
    calibration,
    trackingEvents: (capture.trackingEvents ?? []).map((event) => ({
      kind: event.kind,
      frame: event.frame,
      deviceTimestampNs: event.deviceTimestampNs,
      estimatedDriftM: event.estimatedDriftM,
      correction: event.correction
        ? {
            translation: [event.correction.translation[0], event.correction.translation[1], event.correction.translation[2]] as [number, number, number],
            rotation: normalizeQuat(event.correction.rotation),
          }
        : undefined,
    })),
    mapping: identityMapping(),
  };
};
