import { commitFieldsFromCapture } from "./cameraCapture";
import { rotateVec3 } from "../../domain/shot/cameraRotation";
import { captureMobileSession, mobileCameraSessionSchema } from "../../domain/shot/mobileSession";
import { resolveCameraTakeFrames, selectedTake } from "../../domain/shot/queries";
import { cameraLayersFromSamples } from "../../domain/shot/trackingContinuity";
import { solveWorldCalibration } from "../../domain/shot/worldCalibration";
import type { Quat, Shot, ShotCommand, Vec3 } from "../../domain/shot/types";

const heading = (rotation: Quat): Vec3 => {
  const forward = rotateVec3(rotation, [0, 0, -1]);
  const length = Math.hypot(forward[0], forward[2]);
  if (length > 1e-6) return [forward[0] / length, 0, forward[2] / length];
  const right = rotateVec3(rotation, [1, 0, 0]);
  return [right[2], 0, -right[0]];
};

const ahead = (position: Vec3, direction: Vec3): Vec3 => [position[0] + direction[0], position[1], position[2] + direction[2]];

export const mobileCameraTakeCommand = (input: {
  session: unknown;
  shot: Shot;
  capturedAt: string;
}): Extract<ShotCommand, { type: "COMMIT_CAMERA_TAKE" }> => {
  const session = mobileCameraSessionSchema.parse(input.session);
  const { shot } = input;
  const capture = captureMobileSession(session, { shot, startAtFirstTracked: true });
  const fields = commitFieldsFromCapture({
    ...capture,
    intrinsics: { ...capture.intrinsics, focalLengthMm: capture.intrinsics?.focalLengthMm ?? shot.camera.lens.focalLengthMm },
    samples: capture.samples.filter((sample) => sample.frame < shot.time.durationFrames),
  });
  const first = fields.samples?.find((sample) => sample.trackingState === "normal");
  if (!first || !fields.samples) throw new Error("The phone take has no tracked pose on the shot clock.");
  const anchorTake = selectedTake(shot);
  const anchor = anchorTake ? resolveCameraTakeFrames(anchorTake, shot, { frames: [0] })[0] : undefined;
  const scenePosition: Vec3 = anchor?.position ?? [0, 1.6, 4];
  const sceneRotation: Quat = anchor?.rotation ?? [0, 0, 0, 1];
  const calibration = solveWorldCalibration({
    kind: "points",
    rotation: "yaw_only",
    framework: session.framework,
    calibrationId: "cal_phone_start",
    createdAt: input.capturedAt,
    scale: { mode: "fixed", scale: 1 },
    pairs: [
      { device: first.position, scene: scenePosition },
      { device: ahead(first.position, heading(first.rotation)), scene: ahead(scenePosition, heading(sceneRotation)) },
    ],
  });
  const layers = cameraLayersFromSamples({ samples: fields.samples, calibration, lossPolicy: "hold", applyDriftCorrection: true, jumpThresholdM: 0.05 });
  return { type: "COMMIT_CAMERA_TAKE", shotId: shot.id, source: "record", name: "Phone camera", ...fields, calibration, ...layers };
};
