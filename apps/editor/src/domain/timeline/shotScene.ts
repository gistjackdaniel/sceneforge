import { z } from "zod";

export const shotVec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const shotQuatSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export const assetRevisionRefSchema = z.object({
  assetId: z.string().min(1),
  /** Pin recorded on the shot. Not a content hash — Graph owns hash rules in `core/dependency`. */
  revisionId: z.string().min(1),
});

export type AssetRevisionRef = z.infer<typeof assetRevisionRefSchema>;

export const contactEffectorSchema = z.enum([
  "left_hand",
  "right_hand",
  "left_foot",
  "right_foot",
  "head",
  "pelvis",
]);

export type ContactEffector = z.infer<typeof contactEffectorSchema>;

const frameSample = {
  frame: z.number().int().nonnegative(),
};

/**
 * Timeline's read model of the slices a shot override may cite.
 * This is not the World lane SceneState. The base object is never written by an override command.
 */
export const shotSceneSchema = z.object({
  cameraTracks: z.record(
    z.string(),
    z.object({
      id: z.string().min(1),
      samples: z.array(
        z.object({
          ...frameSample,
          position: shotVec3Schema,
          rotation: shotQuatSchema,
        }),
      ),
    }),
  ),
  setLayout: z.object({
    setAssetRef: assetRevisionRefSchema.optional(),
    objects: z.array(
      z.object({
        id: z.string().min(1),
        assetRef: assetRevisionRefSchema,
        restTranslation: shotVec3Schema,
        restRotation: shotQuatSchema,
      }),
    ),
  }),
  actors: z.record(
    z.string(),
    z.object({
      id: z.string().min(1),
      /** Display label. TargetResolver matches this; it is not the persistent id. */
      label: z.string().min(1),
    }),
  ),
  actorRootMotions: z.record(
    z.string(),
    z.array(
      z.object({
        ...frameSample,
        transl: shotVec3Schema,
        globalOrient: shotQuatSchema,
      }),
    ),
  ),
  contacts: z.record(
    z.string(),
    z.object({
      id: z.string().min(1),
      actorId: z.string().min(1),
      targetActorId: z.string().min(1).optional(),
      effector: contactEffectorSchema,
      /** Shot-local `[start, end)`. */
      frameRange: z.tuple([z.number().int().nonnegative(), z.number().int().positive()]).optional(),
    }),
  ),
});

export type ShotScene = z.infer<typeof shotSceneSchema>;

/** Fresh empty scene. Callers may mutate the returned object; the module keeps no shared copy. */
export const emptyShotScene = (): ShotScene => ({
  cameraTracks: {},
  setLayout: { objects: [] },
  actors: {},
  actorRootMotions: {},
  contacts: {},
});

/**
 * `{assetId, revisionId}` pin from the asset registry's existing version.
 * `revisionId` is `${id}@${version}`, not a content hash.
 * Side effect: none. Does not register a new asset revision.
 */
export const assetRevisionRefFromRecord = (asset: { id: string; version: number }): AssetRevisionRef => ({
  assetId: asset.id,
  revisionId: `${asset.id}@${asset.version}`,
});
