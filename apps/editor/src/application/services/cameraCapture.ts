import type { CommitCameraTakeInput } from "../../domain/graph/cameraPath";
import type { CameraSample, CameraTrackCapture, DeviceCalibration } from "../../domain/graph/cameraTrack";
import { identityCalibration, identityMapping } from "../../domain/graph/cameraTrack";
import { frameToTimecode } from "../../domain/graph/authoringFps";
import { SENSOR_SIZE_MM, type LensParams } from "../../domain/graph/lens";
import type { Quat, Vec3 } from "../../domain/graph/cameraRotation";
import { normalizeQuat } from "../../domain/graph/cameraRotation";

export interface ViewportPoseSample {
  frame: number;
  position: Vec3;
  quaternion: Quat;
}

/**
 * Turn viewport samples into a scene-space CameraTrack capture.
 * The viewport is already in the scene frame, so calibration stays identity and the
 * original samples are the same poses the virtual camera will play.
 */
export const viewportCaptureFromPoses = (input: {
  poses: ViewportPoseSample[];
  fps: number;
  lens: LensParams;
}): CameraTrackCapture => {
  const sensor = SENSOR_SIZE_MM[input.lens.sensorPreset ?? "full-frame"];
  const samples = [...input.poses]
    .sort((a, b) => a.frame - b.frame)
    .map((pose) => ({
      frame: Math.max(0, Math.round(pose.frame)),
      position: [pose.position[0], pose.position[1], pose.position[2]] as [number, number, number],
      rotation: normalizeQuat(pose.quaternion),
      deviceTimestampNs: Math.round((Math.max(0, pose.frame) / input.fps) * 1e9),
      timecode: frameToTimecode(pose.frame, input.fps),
      trackingState: "normal" as const,
      focalLengthMm: input.lens.focalLengthMm,
      focusDistanceM: input.lens.focusDistanceM,
      aperture: input.lens.aperture,
    }));
  return {
    authoredFps: input.fps,
    samples,
    calibration: identityCalibration(),
    intrinsics: {
      focalLengthMm: input.lens.focalLengthMm,
      sensorSizeMm: sensor,
      sensorFit: "horizontal",
    },
    trackingEvents: [],
  };
};

/** Copy a validated capture into the commit input without dropping optional track fields. */
export const commitInputFromCapture = (
  capture: CameraTrackCapture,
  meta: { source: CommitCameraTakeInput["source"]; name?: string; createdAt?: string; id?: string },
): CommitCameraTakeInput => {
  const calibration: DeviceCalibration = capture.calibration
    ? {
        calibrationId: capture.calibration.calibrationId,
        arFramework: capture.calibration.arFramework,
        scale: capture.calibration.scale,
        rotation: normalizeQuat([
          capture.calibration.rotation[0],
          capture.calibration.rotation[1],
          capture.calibration.rotation[2],
          capture.calibration.rotation[3],
        ]),
        translation: [
          capture.calibration.translation[0],
          capture.calibration.translation[1],
          capture.calibration.translation[2],
        ],
        method: capture.calibration.method,
        residualRmsM: capture.calibration.residualRmsM,
        createdAt: capture.calibration.createdAt,
      }
    : identityCalibration();
  const samples: CameraSample[] = capture.samples.map((sample) => ({
    frame: sample.frame,
    position: [sample.position[0], sample.position[1], sample.position[2]],
    rotation: normalizeQuat([sample.rotation[0], sample.rotation[1], sample.rotation[2], sample.rotation[3]]),
    deviceTimestampNs: sample.deviceTimestampNs,
    timecode: sample.timecode,
    trackingState: sample.trackingState ?? "normal",
    focalLengthMm: sample.focalLengthMm,
    focusDistanceM: sample.focusDistanceM,
    aperture: sample.aperture,
  }));
  return {
    ...meta,
    keyframes: samples.map((sample) => ({
      frame: sample.frame,
      position: sample.position,
      rotation: sample.rotation,
      focalLengthMm: sample.focalLengthMm ?? capture.intrinsics?.focalLengthMm ?? 35,
      focusDistanceM: sample.focusDistanceM,
      aperture: sample.aperture,
    })),
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
            translation: [
              event.correction.translation[0],
              event.correction.translation[1],
              event.correction.translation[2],
            ],
            rotation: normalizeQuat([
              event.correction.rotation[0],
              event.correction.rotation[1],
              event.correction.rotation[2],
              event.correction.rotation[3],
            ]),
          }
        : undefined,
    })),
    mapping: identityMapping(),
    authoredFps: capture.authoredFps,
  };
};
