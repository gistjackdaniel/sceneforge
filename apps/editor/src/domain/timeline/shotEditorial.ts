import { z } from "zod";
import { PERSISTENT_ID_PATTERN, legacyShotRevisionId } from "./persistentId";
import {
  assetRevisionRefSchema,
  contactEffectorSchema,
  emptyShotScene,
  shotSceneSchema,
  type AssetRevisionRef,
  type ShotScene,
} from "./shotScene";

/**
 * Opaque tokens stored with an edit for the Graph lane.
 * Selector syntax and canonical hashes will live in `core/dependency`.
 * Timeline records the strings and does not branch on them.
 */
export const shotEditLocalitySchema = z.object({
  preserve: z.array(z.string()),
  recompute: z.array(z.string()),
});

export type ShotEditLocality = z.infer<typeof shotEditLocalitySchema>;

export const shotOverrideEventSchema = z.object({
  id: z.string().regex(PERSISTENT_ID_PATTERN),
  operation: z.literal("change_contact_effector"),
  actorId: z.string().min(1),
  targetActorId: z.string().min(1).optional(),
  contactId: z.string().min(1),
  newEffector: contactEffectorSchema,
  locality: shotEditLocalitySchema,
  createdAt: z.string().min(1),
});

export type ShotOverrideEvent = z.infer<typeof shotOverrideEventSchema>;

export const shotRevisionSchema = z.object({
  id: z.string().regex(PERSISTENT_ID_PATTERN),
  number: z.number().int().positive(),
  parentId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  assetRefs: z.array(assetRevisionRefSchema),
  /** Override stack at this revision. Copied by value so later edits cannot rewrite history. */
  overrides: z.array(shotOverrideEventSchema),
});

export type ShotRevision = z.infer<typeof shotRevisionSchema>;

/** Approval history slot. No workflow writes this in Phase 1. */
export const shotApprovalSchema = z.object({
  id: z.string().min(1),
  revisionId: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  at: z.string().optional(),
  by: z.string().optional(),
  note: z.string().optional(),
});

export type ShotApproval = z.infer<typeof shotApprovalSchema>;

export interface ShotEditorialState {
  scene: ShotScene;
  overrides: ShotOverrideEvent[];
  revisions: ShotRevision[];
  headRevisionId: string;
  approvals: ShotApproval[];
}

const storedEditorialSchema = z.object({
  scene: shotSceneSchema.optional(),
  overrides: z.array(shotOverrideEventSchema).optional(),
  revisions: z.array(shotRevisionSchema).optional(),
  headRevisionId: z.string().optional(),
  approvals: z.array(shotApprovalSchema).optional(),
});

const sameOverrides = (left: readonly ShotOverrideEvent[], right: readonly ShotOverrideEvent[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Keep a valid editorial stack, or open revision 1 when a legacy fps-only shot has none.
 * Does not mutate `existing`. Does not allocate an asset revision.
 */
export const adoptShotEditorial = (
  existing: unknown,
  seed: { shotId: string; createdAt: string; assetRefs: readonly AssetRevisionRef[] },
): ShotEditorialState => {
  const stored = storedEditorialSchema.safeParse(existing);
  const parsed = stored.success ? stored.data : {};
  const scene = parsed.scene ?? emptyShotScene();
  const approvals = parsed.approvals ?? [];
  const revisions = parsed.revisions ?? [];
  if (revisions.length > 0) {
    const head = revisions.find((revision) => revision.id === parsed.headRevisionId) ?? revisions[revisions.length - 1];
    const overrides = parsed.overrides ?? head.overrides;
    if (sameOverrides(head.overrides, overrides)) {
      return { scene, approvals, revisions, overrides, headRevisionId: head.id };
    }
  }

  const overrides = parsed.overrides ?? [];
  const created: ShotRevision = {
    id: legacyShotRevisionId(seed.shotId),
    number: 1,
    createdAt: seed.createdAt,
    assetRefs: seed.assetRefs.map((ref) => ({ ...ref })),
    overrides,
  };
  return {
    scene,
    approvals,
    revisions: [created],
    overrides,
    headRevisionId: created.id,
  };
};
