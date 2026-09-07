import type { CameraKeyframe } from "./cameraPath";

export type CameraRigPreset =
  | "static"
  | "dolly_in"
  | "dolly_out"
  | "truck_left"
  | "truck_right"
  | "pedestal_up"
  | "pedestal_down"
  | "pan"
  | "tilt"
  | "orbit"
  | "crane"
  | "handheld";

export interface CameraPoseInput {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface CameraRigParams {
  preset: CameraRigPreset;
  durationFrames: number;
  startPosition: [number, number, number];
  startRotation: [number, number, number];
}

export const CAMERA_RIG_PRESETS: Array<{ id: CameraRigPreset; label: string }> = [
  { id: "static", label: "Static" },
  { id: "dolly_in", label: "Dolly In" },
  { id: "dolly_out", label: "Dolly Out" },
  { id: "truck_left", label: "Truck Left" },
  { id: "truck_right", label: "Truck Right" },
  { id: "pedestal_up", label: "Pedestal Up" },
  { id: "pedestal_down", label: "Pedestal Down" },
  { id: "pan", label: "Pan" },
  { id: "tilt", label: "Tilt" },
  { id: "orbit", label: "Orbit" },
  { id: "crane", label: "Crane" },
  { id: "handheld", label: "Handheld" },
];

export const cameraRigNodeIdForClip = (clipId: string): string => `node-${clipId}-camera`;

export const normalizeLegacyRig = (rig: string): CameraRigPreset => {
  if (rig === "dolly" || rig === "shoulder") {
    return rig === "dolly" ? "dolly_in" : "handheld";
  }
  return CAMERA_RIG_PRESETS.some((item) => item.id === rig) ? (rig as CameraRigPreset) : "static";
};

const quatFromEuler = (euler: [number, number, number]): [number, number, number, number] => {
  const [x, y, z] = euler;
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
};

const keyframe = (
  frame: number,
  position: [number, number, number],
  rotation: [number, number, number],
  focalLengthMm: number,
): CameraKeyframe => ({
  frame,
  position,
  rotation: quatFromEuler(rotation),
  focalLengthMm,
});

/**
 * Build CameraRigNode params and CameraPathNode keyframes for a preset.
 * Does not create a model-named node. User may edit keyframes afterward.
 */
export const buildRigPreset = (input: {
  preset: CameraRigPreset;
  durationFrames: number;
  start: CameraPoseInput;
  focalLengthMm?: number;
}): { rig: CameraRigParams; keyframes: CameraKeyframe[] } => {
  const duration = Math.max(2, Math.round(input.durationFrames));
  const endFrame = duration - 1;
  const start = input.start.position;
  const rot = input.start.rotation;
  const focal = input.focalLengthMm ?? 35;
  const add = (
    dx: number,
    dy: number,
    dz: number,
    drot: [number, number, number] = [0, 0, 0],
  ): CameraKeyframe[] => [
    keyframe(0, start, rot, focal),
    keyframe(endFrame, [start[0] + dx, start[1] + dy, start[2] + dz], [rot[0] + drot[0], rot[1] + drot[1], rot[2] + drot[2]], focal),
  ];

  let keyframes: CameraKeyframe[];
  switch (input.preset) {
    case "static":
      keyframes = [keyframe(0, start, rot, focal)];
      break;
    case "dolly_in":
      keyframes = add(0, 0, -1.6);
      break;
    case "dolly_out":
      keyframes = add(0, 0, 1.6);
      break;
    case "truck_left":
      keyframes = add(-1.8, 0, 0);
      break;
    case "truck_right":
      keyframes = add(1.8, 0, 0);
      break;
    case "pedestal_up":
      keyframes = add(0, 1.2, 0);
      break;
    case "pedestal_down":
      keyframes = add(0, -0.8, 0);
      break;
    case "pan":
      keyframes = add(0, 0, 0, [0, 0.7, 0]);
      break;
    case "tilt":
      keyframes = add(0, 0, 0, [-0.35, 0, 0]);
      break;
    case "orbit": {
      const radius = 2.4;
      keyframes = [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const angle = t * Math.PI * 2;
        return keyframe(
          Math.round(t * endFrame),
          [Math.sin(angle) * radius, start[1], Math.cos(angle) * radius],
          [rot[0], angle + Math.PI, rot[2]],
          focal,
        );
      });
      break;
    }
    case "crane":
      keyframes = add(0.4, 1.8, -0.8, [-0.25, 0.15, 0]);
      break;
    case "handheld":
      keyframes = [
        keyframe(0, start, rot, focal),
        keyframe(Math.round(endFrame * 0.33), [start[0] + 0.04, start[1] + 0.03, start[2] - 0.02], [rot[0] + 0.02, rot[1] - 0.03, rot[2]], focal),
        keyframe(Math.round(endFrame * 0.66), [start[0] - 0.03, start[1] - 0.02, start[2] + 0.03], [rot[0] - 0.02, rot[1] + 0.02, rot[2]], focal),
        keyframe(endFrame, [start[0] + 0.02, start[1] + 0.01, start[2]], rot, focal),
      ];
      break;
    default:
      keyframes = [keyframe(0, start, rot, focal)];
  }

  return {
    rig: {
      preset: input.preset,
      durationFrames: duration,
      startPosition: start,
      startRotation: rot,
    },
    keyframes,
  };
};

