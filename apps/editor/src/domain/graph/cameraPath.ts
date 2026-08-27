export type CameraInterpolation = "linear" | "bezier" | "catmull_rom";

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
  stabilization?: number;
  interpolation: CameraInterpolation;
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
  if (isCameraPathParams(parameters) && parameters.keyframes.length > 0) {
    return {
      keyframes: parameters.keyframes,
      lookAtTargetNodeId: parameters.lookAtTargetNodeId,
      stabilization: parameters.stabilization,
      interpolation: parameters.interpolation ?? "linear",
      label: parameters.label,
      frameCount: parameters.frameCount,
    };
  }
  return {
    ...defaultCameraPathParams(),
    label: typeof parameters.label === "string" ? parameters.label : undefined,
    frameCount: typeof parameters.frameCount === "number" ? parameters.frameCount : 120,
  };
};
