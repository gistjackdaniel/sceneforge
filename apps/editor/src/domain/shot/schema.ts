import { z } from "zod";
import { SCENE_COORDINATE_CONTRACT, mat4Schema, quatSchema, sceneCoordinateContractSchema } from "../worlds/coordinates";
import { legacyRefSchema } from "../worlds/sceneState";
import { identityCalibration, identityMapping, samplesFromKeyframes } from "./cameraTrack";
import { migrateZyxEncodedQuaternion, normalizeQuat } from "./cameraRotation";
import { migrateCameraTakeIds } from "./takeId";
import type {
  AssetId,
  CameraIntrinsics,
  CameraKey,
  CameraSample,
  CameraTake,
  CameraTakeLegacyRef,
  DeviceCalibration,
  Quat,
  Shot,
  ShotCamera,
  ShotId,
  ShotModelInput,
  Subject,
  SubjectId,
  TakeId,
  TrackingEvent,
} from "./types";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quat = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const brand = <T extends string>(value: string) => value as T;

const transformSchema = z.object({
  position: vec3,
  rotationEuler: vec3,
  scale: vec3,
});

const motionSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("unset") }),
  z.object({ channel: z.literal("text"), prompt: z.string().trim().min(1) }),
  z.object({
    channel: z.literal("explicit"),
    interpolation: z.enum(["linear", "hold"]),
    keys: z.array(transformSchema.extend({ frame: z.number().int().nonnegative() })).min(1),
    provenance: z.object({ kind: z.literal("keyed") }),
  }),
]);

const subjectBase = {
  id: z.string().min(1),
  assetId: z.string().min(1),
  assetVersion: z.number().int().positive(),
  name: z.string().min(1),
  uri: z.string().min(1),
  placement: transformSchema,
  visible: z.boolean(),
  locked: z.boolean(),
};

const assetPinSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
});

const subjectSchema = z.discriminatedUnion("kind", [
  z.object({
    ...subjectBase,
    kind: z.enum(["human", "object"]),
    representation: z.enum(["box", "sphere", "mesh", "marker"]),
    motion: motionSchema,
    instanceId: z.string().min(1).optional(),
    assetRef: assetPinSchema.optional(),
    legacyRefs: z.array(legacyRefSchema).optional(),
    clonedFrom: z.string().min(1).optional(),
  }),
  z.object({
    ...subjectBase,
    kind: z.literal("light"),
    representation: z.literal("light"),
    intensity: z.number().finite().nonnegative(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
]);

const lensSchema = z.object({
  focalLengthMm: z.number().positive(),
  focusDistanceM: z.number().positive().optional(),
  aperture: z.number().positive().optional(),
  sensorPreset: z.string().min(1).optional(),
});

const cameraKeySchema = z.object({
  frame: z.number().int().nonnegative(),
  position: vec3,
  rotation: quat,
  focalLengthMm: z.number().positive(),
  focusDistanceM: z.number().positive().optional(),
  aperture: z.number().positive().optional(),
});

const trackingStateSchema = z.enum(["normal", "limited", "not_available"]);

const cameraSampleSchema = z.object({
  frame: z.number().int().nonnegative(),
  position: vec3,
  rotation: quat,
  deviceTimestampNs: z.number().int().nonnegative().optional(),
  timecode: z.string().min(1).optional(),
  trackingState: trackingStateSchema.optional(),
  focalLengthMm: z.number().positive().optional(),
  focusDistanceM: z.number().positive().optional(),
  aperture: z.number().positive().optional(),
});

const intrinsicsSchema = z.object({
  imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  K: z.tuple([vec3, vec3, vec3]).optional(),
  focalLengthMm: z.number().positive().optional(),
  sensorSizeMm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  sensorFit: z.enum(["horizontal", "vertical", "auto"]).optional(),
  distortion: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]).optional(),
});

const calibrationSchema = z.object({
  calibrationId: z.string().min(1),
  arFramework: z.enum(["arkit", "arcore", "webxr", "viewport", "other"]),
  scale: z.number().positive(),
  rotation: quat,
  translation: vec3,
  method: z.enum(["manual_anchor", "marker", "plane_fit", "identity"]),
  residualRmsM: z.number().nonnegative().optional(),
  createdAt: z.string().min(1),
});

const trackingEventSchema = z.object({
  kind: z.enum(["tracking_lost", "tracking_recovered", "relocalized", "drift_correction"]),
  frame: z.number().int().nonnegative(),
  deviceTimestampNs: z.number().int().nonnegative().optional(),
  correction: z.object({ translation: vec3, rotation: quat }).optional(),
  estimatedDriftM: z.number().nonnegative().optional(),
});

const mappingSchema = z.object({
  mode: z.enum(["one_to_one", "gain", "smoothing", "retiming"]),
  translationGain: vec3,
  rotationGain: z.number().finite(),
  smoothing: z.number().finite(),
  timeScale: z.number().finite(),
  timeOffsetFrames: z.number().finite(),
});

const cameraTakeLegacyRefSchema = z.object({
  kind: z.literal("camera_take"),
  shotId: z.string().min(1),
  takeId: z.string().min(1),
});

const cameraTakeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(["record", "manual", "preset"]),
  keys: z.array(cameraKeySchema).min(1),
  createdAt: z.string().min(1),
  samples: z.array(cameraSampleSchema).optional(),
  intrinsics: intrinsicsSchema.optional(),
  calibration: calibrationSchema.optional(),
  trackingEvents: z.array(trackingEventSchema).optional(),
  mapping: mappingSchema.optional(),
  legacyRefs: z.array(cameraTakeLegacyRefSchema).optional(),
  rotationStorage: z.literal("quaternion_xyzw").optional(),
});

const cameraSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("empty"),
    lens: lensSchema,
    interpolation: z.enum(["linear", "catmull_rom"]),
    retiredTakeIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    status: z.literal("ready"),
    lens: lensSchema,
    interpolation: z.enum(["linear", "catmull_rom"]),
    selectedTakeId: z.string().min(1),
    takes: z.array(cameraTakeSchema).min(1),
    retiredTakeIds: z.array(z.string().min(1)).optional(),
  }),
]).superRefine((camera, ctx) => {
  if (camera.status !== "ready") return;
  if (!camera.takes.some((take) => take.id === camera.selectedTakeId)) {
    ctx.addIssue({ code: "custom", message: "Selected take is not in the shot." });
  }
});

const renderSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  connectorId: z.string().min(1),
  modelVersion: z.string().min(1),
  generateHash: z.string().min(1),
  status: z.enum(["succeeded", "failed", "stubbed", "cancelled"]),
  artifactUri: z.string().min(1).optional(),
  recordedAt: z.string().min(1),
  message: z.string(),
}).superRefine((render, ctx) => {
  if (render.status === "succeeded" && !render.artifactUri) {
    ctx.addIssue({ code: "custom", message: "A finished render needs an artifact." });
  }
});

export const shotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  time: z.object({
    fps: z.number().positive(),
    durationFrames: z.number().int().positive(),
    origin: z.literal("clip_local"),
  }),
  coordinateContract: sceneCoordinateContractSchema.default(SCENE_COORDINATE_CONTRACT),
  subjects: z.array(subjectSchema),
  camera: cameraSchema,
  environment: z.object({ worldId: z.string().min(1) }).optional(),
  renders: z.array(renderSchema),
}).superRefine((shot, ctx) => {
  const ids = new Set<string>();
  for (const subject of shot.subjects) {
    if (ids.has(subject.id)) ctx.addIssue({ code: "custom", message: "Duplicate subject id." });
    ids.add(subject.id);
  }
});

const canonicalPlacementSchema = z.object({
  translation: vec3,
  rotation: quatSchema,
  scale: vec3,
});

const modelSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    assetId: z.string().min(1),
    kind: z.enum(["human", "object"]),
    uri: z.string().min(1),
    placement: transformSchema,
    canonicalPlacement: canonicalPlacementSchema,
    motion: motionSchema,
  }),
  z.object({
    id: z.string().min(1),
    assetId: z.string().min(1),
    kind: z.literal("light"),
    uri: z.string().min(1),
    placement: transformSchema,
    canonicalPlacement: canonicalPlacementSchema,
    intensity: z.number().finite().nonnegative(),
    color: z.string(),
  }),
]);

export const shotModelInputSchema = z.object({
  schemaVersion: z.literal(2),
  source: z.literal("editable_scene"),
  rasterKeyframes: z.literal("forbidden"),
  shotId: z.string().min(1),
  time: z.object({
    fps: z.number().positive(),
    durationFrames: z.number().int().positive(),
    origin: z.literal("clip_local"),
  }),
  coordinateContract: sceneCoordinateContractSchema.default(SCENE_COORDINATE_CONTRACT),
  outputAspect: z.string().min(1),
  subjects: z.array(modelSubjectSchema),
  camera: z.object({
    takeId: z.string().min(1),
    interpolation: z.enum(["linear", "catmull_rom"]),
    keys: z.array(cameraKeySchema).min(1),
    lens: lensSchema,
  }),
  environment: z.object({
    worldId: z.string().min(1),
    geometryUri: z.string().min(1),
    coordinateSystem: z.enum(["Y_UP", "Z_UP"]),
    unitScaleMeters: z.number().positive(),
    importTransform: mat4Schema.optional(),
  }).optional(),
  recipe: z.object({ generateHash: z.string().min(1) }),
});

type ParsedTake = z.infer<typeof cameraTakeSchema>;

const asQuat = (rotation: readonly number[]): [number, number, number, number] =>
  [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1];

/** A unit quaternion is copied as stored so a second load does not drift the bits. */
const stableQuat = (rotation: readonly number[]): [number, number, number, number] => {
  const values = asQuat(rotation);
  const magnitude = Math.hypot(values[0], values[1], values[2], values[3]);
  return Math.abs(magnitude - 1) < 1e-6 ? values : normalizeQuat(values);
};

const storedQuat = (rotation: readonly number[], trust: boolean): Quat =>
  trust ? stableQuat(rotation) : migrateZyxEncodedQuaternion(asQuat(rotation));

const copyIntrinsics = (value: ParsedTake["intrinsics"]): CameraIntrinsics | undefined => {
  if (!value) return undefined;
  return {
    imageSize: value.imageSize ? [value.imageSize[0], value.imageSize[1]] : undefined,
    K: value.K
      ? [
          [value.K[0][0], value.K[0][1], value.K[0][2]],
          [value.K[1][0], value.K[1][1], value.K[1][2]],
          [value.K[2][0], value.K[2][1], value.K[2][2]],
        ]
      : undefined,
    focalLengthMm: value.focalLengthMm,
    sensorSizeMm: value.sensorSizeMm ? [value.sensorSizeMm[0], value.sensorSizeMm[1]] : undefined,
    sensorFit: value.sensorFit,
    distortion: value.distortion
      ? [value.distortion[0], value.distortion[1], value.distortion[2], value.distortion[3], value.distortion[4]]
      : undefined,
  };
};

const copyCalibration = (value: ParsedTake["calibration"]): DeviceCalibration => {
  const fallback = identityCalibration();
  if (!value) return fallback;
  return {
    calibrationId: value.calibrationId,
    arFramework: value.arFramework,
    scale: value.scale,
    rotation: stableQuat(value.rotation),
    translation: [value.translation[0], value.translation[1], value.translation[2]],
    method: value.method,
    residualRmsM: value.residualRmsM,
    createdAt: value.createdAt,
  };
};

const normalizeTake = (take: ParsedTake, fps: number): CameraTake => {
  const trust = take.rotationStorage === "quaternion_xyzw";
  const keys = take.keys.map((key) => ({
    frame: key.frame,
    position: [key.position[0], key.position[1], key.position[2]] as [number, number, number],
    rotation: storedQuat(key.rotation, trust),
    focalLengthMm: key.focalLengthMm,
    focusDistanceM: key.focusDistanceM,
    aperture: key.aperture,
  }));
  const packed = keys as unknown as [CameraKey, ...CameraKey[]];
  const samples: CameraSample[] = take.samples && take.samples.length > 0
    ? take.samples.map((sample) => ({
        frame: sample.frame,
        position: [sample.position[0], sample.position[1], sample.position[2]],
        rotation: storedQuat(sample.rotation, trust),
        deviceTimestampNs: sample.deviceTimestampNs,
        timecode: sample.timecode,
        trackingState: sample.trackingState ?? "normal",
        focalLengthMm: sample.focalLengthMm,
        focusDistanceM: sample.focusDistanceM,
        aperture: sample.aperture,
      }))
    : samplesFromKeyframes(packed, fps);
  const legacyRefs: CameraTakeLegacyRef[] = (take.legacyRefs ?? []).map((ref) => ({
    kind: "camera_take",
    shotId: ref.shotId,
    takeId: ref.takeId,
  }));
  return {
    schemaVersion: 1,
    id: brand<TakeId>(take.id),
    name: take.name,
    source: take.source,
    keys: packed,
    createdAt: take.createdAt,
    samples,
    intrinsics: copyIntrinsics(take.intrinsics),
    calibration: copyCalibration(take.calibration),
    trackingEvents: (take.trackingEvents ?? []) as TrackingEvent[],
    mapping: take.mapping ?? identityMapping(),
    legacyRefs,
    rotationStorage: "quaternion_xyzw",
  };
};

const normalizeCamera = (
  shotId: string,
  fps: number,
  camera: z.infer<typeof cameraSchema>,
): ShotCamera => {
  const retiredTakeIds = (camera.retiredTakeIds ?? []).map((id) => brand<TakeId>(id));
  if (camera.status === "empty") {
    return { status: "empty", lens: camera.lens, interpolation: camera.interpolation, retiredTakeIds };
  }
  const takes = camera.takes.map((take) => normalizeTake(take, fps));
  const migrated = migrateCameraTakeIds(shotId, takes, camera.selectedTakeId);
  const packed = migrated.takes as [CameraTake, ...CameraTake[]];
  return {
    status: "ready",
    lens: camera.lens,
    interpolation: camera.interpolation,
    selectedTakeId: brand<TakeId>(migrated.selectedId),
    takes: packed,
    retiredTakeIds,
  };
};

const brandShot = (shot: z.infer<typeof shotSchema>): Shot => ({
  ...shot,
  id: brand<ShotId>(shot.id),
  subjects: shot.subjects.map((subject) => ({
    ...subject,
    id: brand<SubjectId>(subject.id),
    assetId: brand<AssetId>(subject.assetId),
  })) as Subject[],
  camera: normalizeCamera(shot.id, shot.time.fps, shot.camera),
});

export const parseShot = (input: unknown): Shot => brandShot(shotSchema.parse(input));

export const parseShotModelInput = (input: unknown): ShotModelInput => {
  const parsed = shotModelInputSchema.parse(input);
  return {
    ...parsed,
    shotId: brand<ShotId>(parsed.shotId),
    subjects: parsed.subjects.map((subject) => ({
      ...subject,
      id: brand<SubjectId>(subject.id),
      assetId: brand<AssetId>(subject.assetId),
    })) as ShotModelInput["subjects"],
    camera: {
      ...parsed.camera,
      takeId: brand<TakeId>(parsed.camera.takeId),
    },
  };
};

export const defaultLens = (): z.infer<typeof lensSchema> => ({
  focalLengthMm: 35,
  focusDistanceM: 3,
  aperture: 2.8,
});
