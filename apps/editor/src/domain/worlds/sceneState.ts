import { z } from "zod";
import {
  IDENTITY_TRANSFORM,
  quatSchema,
  sceneCoordinateContractSchema,
  sourceAxesSchema,
  transformSchema,
  type ShotLocalFrame,
  type Transform,
} from "./coordinates";
import { WorldDomainError } from "./errors";
import { ID_PREFIX, newIdSchema, persistentIdSchema, type IdPrefix } from "./ids";

const issue = (ctx: z.RefinementCtx, message: string, path: PropertyKey[]): void => {
  ctx.addIssue({ code: "custom", message, path });
};

/**
 * Asset kind stored on the world scene.
 * `character` / `prop` / `set` are the stage entities. `world` is the legacy world package
 * (`asset-${world.id}`), kept so existing asset ids do not change.
 */
export const assetKindSchema = z.enum([
  "character",
  "prop",
  "set",
  "world",
  "camera_rig",
  "material",
  "other",
]);

export const assetRevisionSchema = z.object({
  revisionId: persistentIdSchema,
  assetId: persistentIdSchema,
  /** Human revision number. Dependency keys use `contentHash`, not this integer. */
  revision: z.number().int().positive(),
  parentRevisionId: persistentIdSchema.optional(),
  /**
   * Dependency key for this revision's bytes.
   * Migrated worlds store a `legacy-fingerprint:` string. A content digest such as
   * SHA-256 is not chosen here; the Graph lane owns that algorithm.
   */
  contentHash: z.string().min(8),
  uri: z.string().min(1),
  sourceAxes: sourceAxesSchema,
  rig: z
    .object({
      skeleton: z.enum(["smplx", "custom"]),
      /** Effector name to skeleton joint. `right_hand` maps to `right_wrist` unless overridden. */
      partMap: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
  legacy: z
    .object({
      assetRecordId: z.string().optional(),
      worldVersion: z.number().int().optional(),
    })
    .optional(),
  createdAt: z.iso.datetime(),
  note: z.string().optional(),
});

export type AssetRevision = z.infer<typeof assetRevisionSchema>;

/**
 * Append-only asset. `revisionIds` grows at the end. Existing revisions are not edited.
 * Renaming `name` does not allocate a new id.
 */
export const assetSchema = z.object({
  id: persistentIdSchema,
  kind: assetKindSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  localizedNames: z.record(z.string(), z.string()).default({}),
  headRevisionId: persistentIdSchema,
  revisionIds: z.array(persistentIdSchema).min(1),
});

export type Asset = z.infer<typeof assetSchema>;

/** Pinned asset revision. Instances never follow the asset head implicitly. */
export const assetRefSchema = z.object({
  assetId: persistentIdSchema,
  revisionId: persistentIdSchema,
});

export type AssetRef = z.infer<typeof assetRefSchema>;

export const legacyRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("world_element"), worldId: z.string(), elementId: z.string() }),
  z.object({ kind: z.literal("world_prop_name"), worldId: z.string(), propName: z.string() }),
  z.object({ kind: z.literal("scene_object"), sceneObjectId: z.string() }),
]);

export type LegacyRef = z.infer<typeof legacyRefSchema>;

const instanceFields = {
  id: persistentIdSchema,
  /** Display name. Not an id. Rename keeps `id` and is excluded from dependency hashes. */
  label: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  localizedNames: z.record(z.string(), z.string()).default({}),
  assetRef: assetRefSchema,
  /** Shot-independent rest pose. Per-shot changes belong on the Timeline override. */
  restTransform: transformSchema,
  /** Set only by clone. */
  clonedFrom: persistentIdSchema.optional(),
  legacyRefs: z.array(legacyRefSchema).default([]),
  /** Tombstone. The id stays reserved and is not minted again. Undo clears this field. */
  deletedAt: z.iso.datetime().optional(),
};

export const actorInstanceSchema = z.object({
  ...instanceFields,
  type: z.literal("actor"),
  skeleton: z.object({
    model: z.literal("smplx"),
    gender: z.enum(["neutral", "male", "female"]).default("neutral"),
    /** Ten SMPL-X shape coefficients, same length as `backboneHumanPoseSchema.betas`. */
    betas: z.array(z.number().finite()).length(10),
  }),
});

export type ActorInstance = z.infer<typeof actorInstanceSchema>;

/** Semantic attachment point. The SMPL-X joint lives in `SMPLX_PART_JOINT` unless a revision overrides it. */
export const rigPartSchema = z.enum([
  "left_hand",
  "right_hand",
  "left_foot",
  "right_foot",
  "head",
  "pelvis",
]);

export type RigPart = z.infer<typeof rigPartSchema>;

export const SMPLX_PART_JOINT: Record<RigPart, string> = {
  left_hand: "left_wrist",
  right_hand: "right_wrist",
  left_foot: "left_ankle",
  right_foot: "right_ankle",
  head: "head",
  pelvis: "pelvis",
};

const RIG_PART_ALIASES: Record<RigPart, readonly string[]> = {
  left_hand: ["left_hand", "left hand", "왼손"],
  right_hand: ["right_hand", "right hand", "오른손"],
  left_foot: ["left_foot", "left foot", "왼발"],
  right_foot: ["right_foot", "right foot", "오른발"],
  head: ["head", "머리"],
  pelvis: ["pelvis", "골반"],
};

/**
 * Map a spoken or written part name to a rig part and its default SMPL-X joint.
 * Returns undefined when the text names zero parts or more than one.
 * This is not on `TargetResolver`; that port only gained optional instance and element ids.
 */
export const resolveRigPart = (refText: string): { rigPart: RigPart; joint: string } | undefined => {
  const query = refText.toLowerCase().normalize("NFKC").trim();
  if (!query) return undefined;
  const hits = rigPartSchema.options.filter((part) =>
    RIG_PART_ALIASES[part].some((alias) => query.includes(alias.toLowerCase())),
  );
  if (hits.length !== 1) return undefined;
  const rigPart = hits[0]!;
  return { rigPart, joint: SMPLX_PART_JOINT[rigPart] };
};

/** Shot-local `[start, end)`. The rate is `Shot.time.fps`; this lane stores integer frames only. */
export const frameRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => end > start, "frame range must be [start, end)");

export type FrameRange = [ShotLocalFrame, ShotLocalFrame];

/**
 * Materialized attachment. The contact graph named by `sourceContactId` is the
 * authority; this record is the pose the world scene can hold onto.
 * Overlap and cycles are Timeline checks and are not rejected here.
 */
export const attachmentSchema = z.object({
  parentInstanceId: persistentIdSchema,
  /** Required when the parent is an actor. Omitted when the parent is an object. */
  rigPart: rigPartSchema.optional(),
  /** Offset in the parent part's local frame. */
  offset: transformSchema,
  frameRange: frameRangeSchema.optional(),
  /** Contact that produced this attachment, for example `cup_hold_01`. */
  sourceContactId: z.string().min(1).optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const objectInstanceSchema = z.object({
  ...instanceFields,
  type: z.literal("object"),
  role: z.enum(["prop", "set_piece", "light", "camera_anchor"]),
  /**
   * `dynamic` is reserved for the Video lane. This schema only records the mode.
   * No dynamic solver runs here.
   */
  motionMode: z.enum(["static", "keyframed", "dynamic"]).default("static"),
  attachments: z.array(attachmentSchema).default([]),
});

export type ObjectInstance = z.infer<typeof objectInstanceSchema>;

export type SceneInstance = ActorInstance | ObjectInstance;

/**
 * World-owned scene description for one world.
 * One scene per world is the current default. A project-wide scene is still an open question.
 * Motion clips, contact events, and camera samples are not stored here.
 */
export const sceneStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    contract: sceneCoordinateContractSchema,
    /** Legacy `WorldAsset.id`. */
    worldId: persistentIdSchema,
    setAssetRef: assetRefSchema,
    assets: z.record(persistentIdSchema, assetSchema),
    revisions: z.record(persistentIdSchema, assetRevisionSchema),
    actors: z.record(persistentIdSchema, actorInstanceSchema),
    objects: z.record(persistentIdSchema, objectInstanceSchema),
  })
  .superRefine((scene, ctx) => {
    const assertKeys = (record: Record<string, { id: string }>, label: string) => {
      for (const [key, value] of Object.entries(record)) {
        if (key !== value.id) issue(ctx, `${label} key does not match id`, [label, key]);
      }
    };
    assertKeys(scene.assets, "assets");
    assertKeys(scene.actors, "actors");
    assertKeys(scene.objects, "objects");
    for (const [key, revision] of Object.entries(scene.revisions)) {
      if (key !== revision.revisionId) issue(ctx, "revision key does not match revisionId", ["revisions", key]);
    }

    for (const asset of Object.values(scene.assets)) {
      if (asset.headRevisionId !== asset.revisionIds[asset.revisionIds.length - 1]) {
        issue(ctx, "headRevisionId is not the last revision", ["assets", asset.id, "headRevisionId"]);
      }
      let previous = 0;
      for (const revisionId of asset.revisionIds) {
        const revision = scene.revisions[revisionId];
        if (!revision) {
          issue(ctx, "asset revision is missing", ["assets", asset.id, "revisionIds"]);
          continue;
        }
        if (revision.assetId !== asset.id) {
          issue(ctx, "revision assetId does not match the asset", ["revisions", revisionId, "assetId"]);
        }
        if (revision.revision <= previous) {
          issue(ctx, "revision list is not append-only", ["assets", asset.id, "revisionIds"]);
        }
        previous = revision.revision;
      }
    }

    for (const revision of Object.values(scene.revisions)) {
      const listed = scene.assets[revision.assetId]?.revisionIds.includes(revision.revisionId) ?? false;
      if (!listed) issue(ctx, "revision is not listed on its asset", ["revisions", revision.revisionId]);
    }

    const setRevision = scene.revisions[scene.setAssetRef.revisionId];
    if (!setRevision || setRevision.assetId !== scene.setAssetRef.assetId) {
      issue(ctx, "setAssetRef does not match a revision", ["setAssetRef"]);
    }

    const overlap = Object.keys(scene.actors).filter((id) => Object.prototype.hasOwnProperty.call(scene.objects, id));
    if (overlap.length > 0) issue(ctx, "actor and object ids overlap", ["actors"]);

    const instances: Record<string, SceneInstance> = { ...scene.actors, ...scene.objects };
    for (const instance of Object.values(instances)) {
      const revision = scene.revisions[instance.assetRef.revisionId];
      if (!revision || revision.assetId !== instance.assetRef.assetId) {
        const bucket = instance.type === "actor" ? "actors" : "objects";
        issue(ctx, "assetRef does not match a revision", [bucket, instance.id, "assetRef"]);
      }
    }

    for (const object of Object.values(scene.objects)) {
      for (const [index, attachment] of object.attachments.entries()) {
        const parentIsActor = Object.prototype.hasOwnProperty.call(scene.actors, attachment.parentInstanceId);
        const parentIsObject = Object.prototype.hasOwnProperty.call(scene.objects, attachment.parentInstanceId);
        const path = ["objects", object.id, "attachments", index];
        if (!parentIsActor && !parentIsObject) issue(ctx, "attachment parent is missing", path);
        if (attachment.parentInstanceId === object.id) issue(ctx, "attachment parent is the object itself", path);
        if (parentIsActor && !attachment.rigPart) issue(ctx, "actor attachment requires rigPart", [...path, "rigPart"]);
        if (parentIsObject && attachment.rigPart) {
          issue(ctx, "object attachment must omit rigPart", [...path, "rigPart"]);
        }
      }
    }
  });

export type SceneState = z.infer<typeof sceneStateSchema>;

const parseScene = (input: unknown): SceneState => {
  const parsed = sceneStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorldDomainError("invalid_scene", "Scene state does not satisfy the world contract.");
  }
  return parsed.data;
};

const findInstance = (scene: SceneState, instanceId: string): SceneInstance => {
  const actor = scene.actors[instanceId];
  const object = scene.objects[instanceId];
  if (actor && object) throw new WorldDomainError("duplicate_instance", "Instance id is ambiguous.");
  const instance = actor ?? object;
  if (!instance) throw new WorldDomainError("missing_instance", "Instance was not found.");
  return instance;
};

const writeInstance = (scene: SceneState, instance: SceneInstance): SceneState => {
  if (instance.type === "actor") {
    return parseScene({ ...scene, actors: { ...scene.actors, [instance.id]: instance } });
  }
  return parseScene({ ...scene, objects: { ...scene.objects, [instance.id]: instance } });
};

/**
 * Change the display name. The persistent id, asset pin, rest transform, and tombstone stay.
 * Does not affect `instance_identity` hashes, which exclude labels.
 * No side effects beyond the returned scene.
 */
export const renameInstance = (
  scene: SceneState,
  instanceId: string,
  patch: { label?: string; aliases?: string[]; localizedNames?: Record<string, string> },
): SceneState => {
  const instance = findInstance(scene, instanceId);
  const label = patch.label ?? instance.label;
  if (label.trim().length === 0) throw new WorldDomainError("invalid_label", "Instance label is empty.");
  return writeInstance(scene, {
    ...instance,
    label,
    aliases: patch.aliases ?? instance.aliases,
    localizedNames: patch.localizedNames ?? instance.localizedNames,
  });
};

/**
 * Append one asset revision and move `headRevisionId`.
 * Existing revision records are left untouched. Instance pins do not follow the new head;
 * call `pinInstanceRevision` or `retargetInstanceAsset` for that.
 * Dependency impact: only instances that are later pinned to this revision change their asset key.
 */
export const appendAssetRevision = (scene: SceneState, revision: AssetRevision): SceneState => {
  const parsed = assetRevisionSchema.safeParse(revision);
  if (!parsed.success) throw new WorldDomainError("invalid_revision", "Asset revision is invalid.");
  const next = parsed.data;
  const asset = scene.assets[next.assetId];
  if (!asset) throw new WorldDomainError("missing_asset", "Asset was not found.");
  if (scene.revisions[next.revisionId] || asset.revisionIds.includes(next.revisionId)) {
    throw new WorldDomainError("revision_immutable", "Asset revisions are append-only.");
  }
  const head = scene.revisions[asset.headRevisionId];
  if (!head || next.revision <= head.revision) {
    throw new WorldDomainError("revision_order", "Revision numbers must increase.");
  }
  if (next.parentRevisionId !== undefined && next.parentRevisionId !== asset.headRevisionId) {
    throw new WorldDomainError("revision_parent", "parentRevisionId must be the current head.");
  }
  const nextAsset: Asset = {
    ...asset,
    headRevisionId: next.revisionId,
    revisionIds: [...asset.revisionIds, next.revisionId],
  };
  return parseScene({
    ...scene,
    assets: { ...scene.assets, [asset.id]: nextAsset },
    revisions: { ...scene.revisions, [next.revisionId]: next },
  });
};

/**
 * Pin one instance to another revision of the same asset. The instance id stays.
 * Invalidates dependency keys that include this instance's `assetRef.revisionId` only.
 */
export const pinInstanceRevision = (scene: SceneState, instanceId: string, revisionId: string): SceneState => {
  const instance = findInstance(scene, instanceId);
  const revision = scene.revisions[revisionId];
  if (!revision || revision.assetId !== instance.assetRef.assetId) {
    throw new WorldDomainError("missing_revision", "Revision of the same asset was not found.");
  }
  return writeInstance(scene, {
    ...instance,
    assetRef: { assetId: instance.assetRef.assetId, revisionId },
  });
};

/**
 * Point an instance at a different asset revision. The instance id stays, so the role
 * ("B", "the cup") survives an asset swap. Both `assetId` and `revisionId` change together.
 */
export const retargetInstanceAsset = (scene: SceneState, instanceId: string, assetRef: AssetRef): SceneState => {
  const instance = findInstance(scene, instanceId);
  const revision = scene.revisions[assetRef.revisionId];
  if (!revision || revision.assetId !== assetRef.assetId) {
    throw new WorldDomainError("missing_revision", "Asset revision was not found.");
  }
  return writeInstance(scene, { ...instance, assetRef: { assetId: assetRef.assetId, revisionId: assetRef.revisionId } });
};

const idInScene = (scene: SceneState, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(scene.actors, id) ||
  Object.prototype.hasOwnProperty.call(scene.objects, id) ||
  Object.prototype.hasOwnProperty.call(scene.assets, id) ||
  Object.prototype.hasOwnProperty.call(scene.revisions, id);

/**
 * Clone an instance onto a newly minted id.
 * Copies the asset pin, rest transform, and skeleton or role. Does not copy attachments.
 * Motion clips and shot overrides are not in this scene, so they are not copied.
 * The source id stays. `clonedFrom` records it.
 */
export const cloneInstance = (scene: SceneState, instanceId: string, newId: string, label: string): SceneState => {
  const instance = findInstance(scene, instanceId);
  if (instance.deletedAt) throw new WorldDomainError("deleted_instance", "Deleted instances cannot be cloned.");
  if (label.trim().length === 0) throw new WorldDomainError("invalid_label", "Instance label is empty.");
  const prefix: IdPrefix = instance.type === "actor" ? ID_PREFIX.actor : ID_PREFIX.object;
  if (!newIdSchema(prefix).safeParse(newId).success) {
    throw new WorldDomainError("invalid_id", "Clone id must be a new persistent id.");
  }
  if (idInScene(scene, newId)) throw new WorldDomainError("id_reused", "Persistent ids are never reused.");
  if (instance.type === "actor") {
    const copy: ActorInstance = { ...instance, id: newId, label, clonedFrom: instance.id, deletedAt: undefined };
    return writeInstance(scene, copy);
  }
  const copy: ObjectInstance = {
    ...instance,
    id: newId,
    label,
    clonedFrom: instance.id,
    attachments: [],
    deletedAt: undefined,
  };
  return writeInstance(scene, copy);
};

/**
 * Tombstone an instance. The id remains in the scene and must not be minted again.
 * A second delete keeps the original `deletedAt`. Undo is `restoreInstance`.
 * `instance_identity` changes because the tombstone flag changes.
 */
export const deleteInstance = (scene: SceneState, instanceId: string, deletedAt: string): SceneState => {
  if (!z.iso.datetime().safeParse(deletedAt).success) {
    throw new WorldDomainError("invalid_timestamp", "Deletion time must be an ISO timestamp.");
  }
  const instance = findInstance(scene, instanceId);
  if (instance.deletedAt) return scene;
  return writeInstance(scene, { ...instance, deletedAt });
};

/**
 * Clear a tombstone. The id is unchanged. This is the undo of `deleteInstance`.
 */
export const restoreInstance = (scene: SceneState, instanceId: string): SceneState => {
  const instance = findInstance(scene, instanceId);
  if (!instance.deletedAt) return scene;
  const { deletedAt: _deletedAt, ...rest } = instance;
  return writeInstance(scene, rest);
};

/** Every id the scene still owns, including tombstones and revisions. Pass these to the id factory. */
export const scenePersistentIds = (scene: SceneState): string[] => [
  ...Object.keys(scene.assets),
  ...Object.keys(scene.revisions),
  ...Object.keys(scene.actors),
  ...Object.keys(scene.objects),
];

export const jointForRigPart = (part: RigPart, partMap?: Record<string, string>): string =>
  partMap?.[part] ?? SMPLX_PART_JOINT[part];

export { IDENTITY_TRANSFORM, quatSchema };
