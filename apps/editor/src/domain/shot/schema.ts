import { z } from "zod";
import { shotApprovalSchema, shotContactSchema, shotOverrideEventSchema, shotRevisionSchema } from "./editorial";
import type {
  AssetId,
  CameraTake,
  Shot,
  ShotId,
  ShotModelInput,
  Subject,
  SubjectId,
  TakeId,
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

const subjectSchema = z.discriminatedUnion("kind", [
  z.object({
    ...subjectBase,
    kind: z.enum(["human", "object"]),
    representation: z.enum(["box", "sphere", "mesh", "marker"]),
    motion: motionSchema,
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

const cameraTakeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(["record", "manual", "preset"]),
  keys: z.array(cameraKeySchema).min(1),
  createdAt: z.string().min(1),
});

const cameraSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("empty"),
    lens: lensSchema,
    interpolation: z.enum(["linear", "catmull_rom"]),
  }),
  z.object({
    status: z.literal("ready"),
    lens: lensSchema,
    interpolation: z.enum(["linear", "catmull_rom"]),
    selectedTakeId: z.string().min(1),
    takes: z.array(cameraTakeSchema).min(1),
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
  subjects: z.array(subjectSchema),
  camera: cameraSchema,
  environment: z.object({ worldId: z.string().min(1) }).optional(),
  renders: z.array(renderSchema),
  contacts: z.array(shotContactSchema).optional(),
  overrides: z.array(shotOverrideEventSchema).optional(),
  revisions: z.array(shotRevisionSchema).optional(),
  headRevisionId: z.string().min(1).optional(),
  approvals: z.array(shotApprovalSchema).optional(),
}).superRefine((shot, ctx) => {
  const ids = new Set<string>();
  for (const subject of shot.subjects) {
    if (ids.has(subject.id)) ctx.addIssue({ code: "custom", message: "Duplicate subject id." });
    ids.add(subject.id);
  }
  if (!shot.headRevisionId) return;
  const head = shot.revisions?.find((revision) => revision.id === shot.headRevisionId);
  if (!head) {
    ctx.addIssue({ code: "custom", message: "Head revision is not in the shot." });
    return;
  }
  if (JSON.stringify(head.overrides) !== JSON.stringify(shot.overrides ?? [])) {
    ctx.addIssue({ code: "custom", message: "Head revision does not match the override stack." });
  }
});

const modelSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    assetId: z.string().min(1),
    kind: z.enum(["human", "object"]),
    uri: z.string().min(1),
    placement: transformSchema,
    motion: motionSchema,
  }),
  z.object({
    id: z.string().min(1),
    assetId: z.string().min(1),
    kind: z.literal("light"),
    uri: z.string().min(1),
    placement: transformSchema,
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
  }).optional(),
  recipe: z.object({ generateHash: z.string().min(1) }),
});

const brandSubjectId = (value: string) => brand<SubjectId>(value);

const brandEvent = <T extends { actorId: string }>(event: T): T & { actorId: SubjectId } => ({
  ...event,
  actorId: brandSubjectId(event.actorId),
});

const brandShot = (shot: z.infer<typeof shotSchema>): Shot => ({
  ...shot,
  id: brand<ShotId>(shot.id),
  subjects: shot.subjects.map((subject) => ({
    ...subject,
    id: brand<SubjectId>(subject.id),
    assetId: brand<AssetId>(subject.assetId),
  })) as Subject[],
  camera: shot.camera.status === "empty"
    ? shot.camera
    : {
        ...shot.camera,
        selectedTakeId: brand<TakeId>(shot.camera.selectedTakeId),
        takes: shot.camera.takes.map((take) => ({ ...take, id: brand<TakeId>(take.id) })) as unknown as ReadyTakes,
      },
  contacts: shot.contacts?.map((contact) => ({
    ...contact,
    actorId: brandSubjectId(contact.actorId),
    targetActorId: contact.targetActorId ? brandSubjectId(contact.targetActorId) : undefined,
  })),
  overrides: shot.overrides?.map(brandEvent),
  revisions: shot.revisions?.map((revision) => ({
    ...revision,
    overrides: revision.overrides.map(brandEvent),
  })),
});

type ReadyTakes = readonly [CameraTake, ...CameraTake[]];

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
