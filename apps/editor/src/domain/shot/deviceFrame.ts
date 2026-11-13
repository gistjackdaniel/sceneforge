import * as THREE from "three";
import { normalizeQuat, rotateVec3, type Quat, type Vec3 } from "./cameraRotation";

/**
 * Scene camera frame this adapter writes into.
 * Right-handed, +Y up, meters, asset forward +Z.
 * Camera local frame is GL: +X right, +Y up, −Z look.
 */
export const SCENE_CAMERA_FRAME = {
  handedness: "right",
  upAxis: "+Y",
  forwardAxis: "+Z",
  unit: "meter",
  cameraLook: "-Z",
} as const;

/**
 * ARKit, ARCore, and WebXR session worlds match the scene basis:
 * right-handed, +Y up, meters. Their camera local frame is also GL (−Z look).
 * The basis change is therefore the identity. Origin, yaw, and scale belong
 * to world calibration, not to this map.
 */
export const DEVICE_SESSION_FRAME = {
  arkit: { handedness: "right", upAxis: "+Y", unit: "meter", cameraLook: "-Z" },
  arcore: { handedness: "right", upAxis: "+Y", unit: "meter", cameraLook: "-Z" },
  webxr: { handedness: "right", upAxis: "+Y", unit: "meter", cameraLook: "-Z" },
} as const;

export type DeviceFramework = keyof typeof DEVICE_SESSION_FRAME;

export type DevicePose = {
  position: Vec3;
  rotation: Quat;
};

const copyVec3 = (value: Vec3): [number, number, number] => [value[0], value[1], value[2]];

/**
 * Map a device-world point into the scene basis.
 * For ARKit, ARCore, and WebXR this keeps +X, +Y, and +Z, including meters.
 */
export const devicePointToScene = (framework: DeviceFramework, point: Vec3): [number, number, number] => {
  if (!DEVICE_SESSION_FRAME[framework]) {
    throw new Error("Unsupported device frame.");
  }
  return copyVec3(point);
};

/**
 * Column-major 4×4 camera-to-world, the layout ARKit `simd_float4x4` and WebXR use.
 * Returns the device-world pose before the scene basis change.
 */
export const poseFromColumnMajor = (transform: readonly number[]): DevicePose => {
  if (transform.length !== 16) throw new Error("A device transform needs 16 numbers.");
  const matrix = new THREE.Matrix4().fromArray([...transform]);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return {
    position: [position.x, position.y, position.z],
    rotation: normalizeQuat([rotation.x, rotation.y, rotation.z, rotation.w]),
  };
};

/**
 * OpenCV camera local frame (look +Z, Y down) → GL camera local frame (look −Z, Y up).
 * World position is unchanged. `R_gl = R_cv · diag(1, −1, −1)`, the inverse of
 * `BackboneCameraBuilder.glToOpenCvRotation`. Export still goes through that builder.
 */
export const opencvCameraToGl = (rotation: Quat): [number, number, number, number] => {
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
  );
  const elements = matrix.elements;
  for (const index of [4, 5, 6, 7, 8, 9, 10, 11]) {
    const value = elements[index];
    if (value !== undefined) elements[index] = -value;
  }
  const gl = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return normalizeQuat([gl.x, gl.y, gl.z, gl.w]);
};

/**
 * Device session pose → scene camera pose (GL local frame, scene basis).
 * `cameraLocal: "opencv"` flips the camera axes. The world basis stays Y-up.
 */
export const devicePoseToScenePose = (
  framework: DeviceFramework,
  pose: DevicePose,
  cameraLocal: "gl" | "opencv" = "gl",
): DevicePose => {
  const position = devicePointToScene(framework, pose.position);
  const rotation = cameraLocal === "opencv" ? opencvCameraToGl(pose.rotation) : normalizeQuat(pose.rotation);
  return { position, rotation };
};

/** World direction the GL camera looks, `R · (0, 0, −1)`. */
export const glCameraLook = (rotation: Quat): [number, number, number] => rotateVec3(rotation, [0, 0, -1]);
