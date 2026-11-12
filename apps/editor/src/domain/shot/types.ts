export type ShotId = string & { readonly __brand: "ShotId" };
export type SubjectId = string & { readonly __brand: "SubjectId" };
export type AssetId = string & { readonly __brand: "AssetId" };
export type TakeId = string & { readonly __brand: "TakeId" };

export const shotId = (value: string): ShotId => value as ShotId;
export const subjectId = (value: string): SubjectId => value as SubjectId;
export const takeId = (value: string): TakeId => value as TakeId;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type Transform = {
  position: Vec3;
  rotationEuler: Vec3;
  scale: Vec3;
};

export type Lens = {
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  sensorPreset?: string;
};

export type ShotTime = {
  fps: number;
  durationFrames: number;
  origin: "clip_local";
};

export type ObjectPoseKey = Transform & { frame: number };

/** MVP keys are authored on Stage. A later action event writes the same keys and extends provenance. */
export type MotionProvenance = { kind: "keyed" };

export type Motion =
  | { channel: "unset" }
  | { channel: "text"; prompt: string }
  | {
      channel: "explicit";
      interpolation: "linear" | "hold";
      keys: readonly [ObjectPoseKey, ...ObjectPoseKey[]];
      provenance: MotionProvenance;
    };

type SubjectBase = {
  id: SubjectId;
  /** 3D asset identity. Shared by instances of the same primitive or file. */
  assetId: AssetId;
  assetVersion: number;
  name: string;
  uri: string;
  placement: Transform;
  visible: boolean;
  locked: boolean;
};

export type PosedSubject = SubjectBase & {
  kind: "human" | "object";
  representation: "box" | "sphere" | "mesh" | "marker";
  motion: Motion;
};

export type LightSubject = SubjectBase & {
  kind: "light";
  representation: "light";
  intensity: number;
  color: string;
};

export type Subject = PosedSubject | LightSubject;

export type CameraKey = {
  frame: number;
  position: Vec3;
  rotation: Quat;
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
};

/** Previous take id kept so a deterministic migration can be repeated. Same shape as a World legacy ref. */
export type CameraTakeLegacyRef = {
  kind: "camera_take";
  shotId: string;
  takeId: string;
};

export type TrackingState = "normal" | "limited" | "not_available";

/** Original sample. Calibration and mapping never write back into this list. */
export type CameraSample = {
  frame: number;
  position: Vec3;
  rotation: Quat;
  deviceTimestampNs?: number;
  timecode?: string;
  trackingState: TrackingState;
  focalLengthMm?: number;
  focusDistanceM?: number;
  aperture?: number;
};

/** Pixel K plus the lens data it was built from. K is omitted until an image size is known. */
export type CameraIntrinsics = {
  imageSize?: readonly [number, number];
  K?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  focalLengthMm?: number;
  sensorSizeMm?: readonly [number, number];
  sensorFit?: "horizontal" | "vertical" | "auto";
  /** OpenCV order k1, k2, p1, p2, k3. Kept from the device unchanged. */
  distortion?: readonly [number, number, number, number, number];
};

/**
 * Similarity `T_world_device`. Scene position is `scale * R * p_device + translation`.
 * Scene orientation is `rotation * deviceRotation`.
 */
export type DeviceCalibration = {
  calibrationId: string;
  arFramework: "arkit" | "arcore" | "webxr" | "viewport" | "other";
  scale: number;
  rotation: Quat;
  translation: Vec3;
  method: "manual_anchor" | "marker" | "plane_fit" | "identity";
  residualRmsM?: number;
  createdAt: string;
};

export type TrackingEvent = {
  kind: "tracking_lost" | "tracking_recovered" | "relocalized" | "drift_correction";
  frame: number;
  deviceTimestampNs?: number;
  correction?: { translation: Vec3; rotation: Quat };
  estimatedDriftM?: number;
};

/**
 * Physical camera → virtual camera. Stored beside the original samples.
 * Only `mode` is applied; the other numbers stay so switching mode does not drop them.
 */
export type CameraMotionMapping = {
  mode: "one_to_one" | "gain" | "smoothing" | "retiming";
  translationGain: Vec3;
  rotationGain: number;
  /** 0 copies the pose. 1 holds the previous pose. */
  smoothing: number;
  timeScale: number;
  timeOffsetFrames: number;
  /**
   * How virtual keys fill samples whose tracking state is limited or lost.
   * `preserve` keeps the recorded pose. The original samples are not rewritten.
   */
  lossPolicy?: "preserve" | "hold" | "interpolate";
  /** When false or omitted, `drift_correction` events are ignored. */
  applyDriftCorrection?: boolean;
};

export type CameraTake = {
  schemaVersion: 1;
  id: TakeId;
  name: string;
  source: "record" | "manual" | "preset";
  /** Virtual camera keys. Viewport playback reads these. */
  keys: readonly [CameraKey, ...CameraKey[]];
  createdAt: string;
  /** Original samples. Calibration and mapping never replace this list. */
  samples: readonly CameraSample[];
  intrinsics?: CameraIntrinsics;
  calibration: DeviceCalibration;
  trackingEvents: readonly TrackingEvent[];
  mapping: CameraMotionMapping;
  /** Earlier ids this take was migrated from. Not a second live id. */
  legacyRefs: readonly CameraTakeLegacyRef[];
  /** Present after the one-time ZYX → XYZ quaternion migration. */
  rotationStorage: "quaternion_xyzw";
};

export type CameraInterpolation = "linear" | "catmull_rom";

export type EmptyCamera = {
  status: "empty";
  lens: Lens;
  interpolation: CameraInterpolation;
  /** Deleted take ids. A later mint will not return them. */
  retiredTakeIds: readonly TakeId[];
};

export type ReadyCamera = {
  status: "ready";
  lens: Lens;
  interpolation: CameraInterpolation;
  selectedTakeId: TakeId;
  takes: readonly [CameraTake, ...CameraTake[]];
  retiredTakeIds: readonly TakeId[];
};

export type ShotCamera = EmptyCamera | ReadyCamera;

export type ShotWithSelectedTake = Shot & { camera: ReadyCamera };

export type ShotRenderStatus = "succeeded" | "failed" | "stubbed" | "cancelled";

export type ShotRender = {
  id: string;
  jobId: string;
  connectorId: string;
  modelVersion: string;
  generateHash: string;
  status: ShotRenderStatus;
  artifactUri?: string;
  recordedAt: string;
  message: string;
};

export type Shot = {
  schemaVersion: 1;
  id: ShotId;
  name: string;
  time: ShotTime;
  subjects: readonly Subject[];
  camera: ShotCamera;
  environment?: { worldId: string };
  renders: readonly ShotRender[];
};

export type EnvironmentView = {
  worldId: string;
  representation: string;
  geometryUri?: string;
  coordinateSystem: "Y_UP" | "Z_UP";
  unitScaleMeters: number;
};

export type ModelSubject =
  | {
      id: SubjectId;
      assetId: AssetId;
      kind: "human" | "object";
      uri: string;
      placement: Transform;
      motion: Motion;
    }
  | {
      id: SubjectId;
      assetId: AssetId;
      kind: "light";
      uri: string;
      placement: Transform;
      intensity: number;
      color: string;
    };

/** Single payload derived from a shot. Not a second stored document. */
export type ShotModelInput = {
  schemaVersion: 2;
  source: "editable_scene";
  rasterKeyframes: "forbidden";
  shotId: ShotId;
  time: ShotTime;
  outputAspect: string;
  subjects: readonly ModelSubject[];
  camera: {
    takeId: TakeId;
    interpolation: CameraInterpolation;
    keys: readonly CameraKey[];
    lens: Lens;
  };
  environment?: {
    worldId: string;
    geometryUri: string;
    coordinateSystem: "Y_UP" | "Z_UP";
    unitScaleMeters: number;
  };
  recipe: { generateHash: string };
};

export type GenerateBlocker =
  | { code: "no_selected_take"; message: string }
  | { code: "proxy_world"; message: string }
  | { code: "marker_only"; message: string };

export type SubjectDraft =
  | { kind: "object"; id?: string; name: string; primitive: "box" | "sphere"; placement?: Transform }
  | { kind: "object"; id?: string; name: string; fileUri: string; placement?: Transform }
  | { kind: "human"; id?: string; name: string; fileUri: string; placement?: Transform }
  | { kind: "light"; id?: string; name: string; placement?: Transform }
  | { kind: "marker"; id?: string; name: string; role: "human" | "object"; placement?: Transform };

export type ShotCommand =
  | { type: "ADD_SUBJECT"; shotId: ShotId; draft: SubjectDraft }
  | { type: "REMOVE_SUBJECT"; shotId: ShotId; subjectId: SubjectId }
  | { type: "SET_SUBJECT_PLACEMENT"; shotId: ShotId; subjectId: SubjectId; placement: Transform }
  | { type: "SET_SUBJECT_FLAGS"; shotId: ShotId; subjectId: SubjectId; visible?: boolean; locked?: boolean }
  | { type: "SET_LIGHT"; shotId: ShotId; subjectId: SubjectId; intensity?: number; color?: string }
  | { type: "SET_TEXT_POSE"; shotId: ShotId; subjectId: SubjectId; prompt: string }
  | { type: "KEY_SUBJECT_POSE"; shotId: ShotId; subjectId: SubjectId; key: ObjectPoseKey }
  | { type: "DELETE_SUBJECT_POSE_KEY"; shotId: ShotId; subjectId: SubjectId; frame: number }
  | { type: "REPLACE_SUBJECT"; shotId: ShotId; subject: Subject }
  | { type: "REPLACE_CAMERA"; shotId: ShotId; camera: ShotCamera }
  | { type: "REPLACE_SHOT"; shotId: ShotId; shot: Shot }
  | { type: "DROP_RENDER"; shotId: ShotId; renderId: string }
  | {
      type: "COMMIT_CAMERA_TAKE";
      shotId: ShotId;
      source: "record" | "manual";
      keys: readonly [CameraKey, ...CameraKey[]];
      name?: string;
      samples?: readonly CameraSample[];
      intrinsics?: CameraIntrinsics;
      calibration?: DeviceCalibration;
      trackingEvents?: readonly TrackingEvent[];
      mapping?: CameraMotionMapping;
    }
  | {
      type: "SET_CAMERA_TRACK_MAPPING";
      shotId: ShotId;
      takeId?: TakeId;
      mapping: CameraMotionMapping;
    }
  | {
      type: "SET_DEVICE_CALIBRATION";
      shotId: ShotId;
      takeId?: TakeId;
      calibration: DeviceCalibration;
    }
  | { type: "KEY_CAMERA"; shotId: ShotId; key: CameraKey }
  | { type: "DELETE_CAMERA_KEY"; shotId: ShotId; frame: number }
  | { type: "SELECT_CAMERA_TAKE"; shotId: ShotId; takeId: TakeId }
  | { type: "DELETE_CAMERA_TAKE"; shotId: ShotId; takeId: TakeId }
  | { type: "SET_LENS"; shotId: ShotId; lens: Lens }
  | { type: "SET_CAMERA_INTERPOLATION"; shotId: ShotId; interpolation: CameraInterpolation }
  | { type: "APPLY_CAMERA_PRESET"; shotId: ShotId; keys: readonly [CameraKey, ...CameraKey[]] }
  | { type: "TRIM_KEYS"; shotId: ShotId }
  | { type: "SET_SHOT_TIME"; shotId: ShotId; fps: number; durationFrames: number }
  | { type: "RECORD_SHOT_RENDER"; shotId: ShotId; receipt: ShotRender };
