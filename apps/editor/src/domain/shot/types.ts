import type { RigPart } from "../worlds/sceneState";

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

export type CameraTake = {
  schemaVersion: 1;
  id: TakeId;
  name: string;
  source: "record" | "manual" | "preset";
  keys: readonly [CameraKey, ...CameraKey[]];
  createdAt: string;
};

export type CameraInterpolation = "linear" | "catmull_rom";

export type EmptyCamera = {
  status: "empty";
  lens: Lens;
  interpolation: CameraInterpolation;
};

export type ReadyCamera = {
  status: "ready";
  lens: Lens;
  interpolation: CameraInterpolation;
  selectedTakeId: TakeId;
  takes: readonly [CameraTake, ...CameraTake[]];
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

/**
 * Same pair as a world `AssetRef`. Shot-record asset ids include `primitive:*`,
 * so the pin keeps those strings instead of the world persistent-id pattern.
 */
export type ShotAssetRef = {
  assetId: string;
  revisionId: string;
};

export type ShotContact = {
  id: string;
  actorId: SubjectId;
  targetActorId?: SubjectId;
  effector: RigPart;
};

/** Structured edit. `preserve` and `recompute` stay opaque strings. */
export type ShotOverrideEvent = {
  id: string;
  operation: "change_contact_effector";
  contactId: string;
  actorId: SubjectId;
  effector: RigPart;
  preserve: readonly string[];
  recompute: readonly string[];
};

export type ShotRevision = {
  id: string;
  parentId?: string;
  createdAt: string;
  overrides: readonly ShotOverrideEvent[];
  assetRefs: readonly ShotAssetRef[];
};

export type ShotApproval = {
  revisionId: string;
  status: "pending" | "approved" | "rejected";
  at?: string;
};

export type Shot = {
  schemaVersion: 1;
  id: ShotId;
  name: string;
  /** `time.fps` is the only frame rate. `origin` stays `clip_local`. Frames are integers. */
  time: ShotTime;
  subjects: readonly Subject[];
  camera: ShotCamera;
  environment?: { worldId: string };
  renders: readonly ShotRender[];
  /** Base contacts. Override events do not replace this list. */
  contacts?: readonly ShotContact[];
  overrides?: readonly ShotOverrideEvent[];
  revisions?: readonly ShotRevision[];
  headRevisionId?: string;
  /** Data only. No approval UI. */
  approvals?: readonly ShotApproval[];
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
  | { type: "RECORD_SHOT_RENDER"; shotId: ShotId; receipt: ShotRender }
  | {
      type: "ADD_SHOT_OVERRIDE";
      shotId: ShotId;
      contactId: string;
      actorSubjectId: SubjectId;
      targetSubjectId?: SubjectId;
      newEffector: string;
      preserve: readonly string[];
      recompute: readonly string[];
    }
  | { type: "UPDATE_SHOT_OVERRIDE"; shotId: ShotId; eventId: string; newEffector: string }
  | { type: "REMOVE_SHOT_OVERRIDE"; shotId: ShotId; eventId: string }
  | { type: "REVERT_SHOT_REVISION"; shotId: ShotId; revisionId: string };
