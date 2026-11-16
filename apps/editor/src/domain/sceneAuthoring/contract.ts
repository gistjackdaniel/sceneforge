import { z } from "zod";
import { rigPartSchema, SMPLX_PART_JOINT, type RigPart } from "../worlds/sceneState";
import type { Quat, Vec3 } from "./math";

export { rigPartSchema, SMPLX_PART_JOINT, type RigPart };

/**
 * Playback format shared with the Video lane's pose export.
 * That lane's modules are not on this branch, so nothing here imports them.
 *
 * - `subjectId` is `Shot.subjects[].id`, copied as a string. Do not parse `act_` / `obj_` / `inst_`.
 * - `frame` / `t` is an integer on `Shot.time`. Ranges are half-open `[startFrame, endFrame)`.
 * - `fps` is read only from `Shot.time.fps`. This record does not store a clock.
 * - Actor pelvis is the shot pose: `position`, `rotationEuler` (`XYZ`), `scale`.
 * - A dynamic object is a dense `T_world_obj` per frame with `source: "generated"`.
 * - A contact endpoint names a `subjectId` and, for a hand, a `rigPart`.
 * - World targets are `WorldAsset.id` only.
 */

export const PLAYBACK_FORMAT = {
  subjectId: "Shot.subjects[].id",
  frame: "integer shot-local frame",
  range: "[startFrame, endFrame)",
  fps: "Shot.time.fps",
  pelvis: "position + rotationEuler XYZ + scale",
  object: "dense T_world_obj, source generated",
  contact: "subjectId + optional rigPart",
  worldTarget: "WorldAsset.id",
} as const;

/** Video lane's motion source. Not written into `MotionProvenance` — that enum is only `keyed` here. */
export const GENERATED_POSE_SOURCE = "generated" as const;

const finite = z.number().finite();
export const vec3Schema = z.tuple([finite, finite, finite]);
export const quatSchema = z
  .tuple([finite, finite, finite, finite])
  .refine((value) => Math.abs(Math.hypot(...value) - 1) < 1e-4, "단위 쿼터니언이 아님");

export const transformSchema = z.object({
  translation: vec3Schema,
  rotation: quatSchema,
});
export type Transform = { translation: Vec3; rotation: Quat };

export const subjectBindingSchema = z.object({
  subjectId: z.string().min(1),
  worldAssetId: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["actor", "prop", "set_piece"]),
  color: z.string().min(1),
});
export type SubjectBinding = z.infer<typeof subjectBindingSchema>;

export const contactKindSchema = z.enum(["hand_hand", "hand_object", "object_surface"]);
export type ContactKind = z.infer<typeof contactKindSchema>;

export const contactEndpointSchema = z.object({
  subjectId: z.string().min(1),
  rigPart: rigPartSchema.optional(),
});
export type ContactEndpoint = { subjectId: string; rigPart?: RigPart };

export const contactEventSchema = z.object({
  contactId: z.string().min(1),
  kind: contactKindSchema,
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  a: contactEndpointSchema,
  b: contactEndpointSchema,
  actionType: z.enum(["grasp", "strike", "support", "place"]).optional(),
});
export type ContactEvent = z.infer<typeof contactEventSchema>;

export const contactEffectorOverrideSchema = z.object({
  contactId: z.string().min(1),
  worldAssetId: z.string().min(1),
  subjectId: z.string().min(1),
  rigPart: rigPartSchema,
});
export type ContactEffectorOverride = z.infer<typeof contactEffectorOverrideSchema>;

export const interactionPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    shotId: z.string().min(1),
    /** Room / background. The shot's `environment.worldId` is what playback preserves. */
    worldAssetId: z.string().min(1),
    bindings: z.array(subjectBindingSchema).min(1),
    contacts: z.array(contactEventSchema),
    /** object subjectId → contactId → parent-local offset. Attachment is not the source of truth. */
    attachmentOffsets: z.record(z.string(), z.record(z.string(), transformSchema)).default({}),
    overrides: z.array(contactEffectorOverrideSchema).default([]),
  })
  .superRefine((preview, ctx) => {
    const subjectIds = new Set<string>();
    for (const binding of preview.bindings) {
      if (subjectIds.has(binding.subjectId)) {
        ctx.addIssue({ code: "custom", message: `subject id 중복: ${binding.subjectId}` });
      }
      subjectIds.add(binding.subjectId);
    }
    const known = (id: string, path: string) => {
      if (!subjectIds.has(id)) ctx.addIssue({ code: "custom", message: `${path}: 없는 subject ${id}` });
    };
    for (const contact of preview.contacts) {
      if (contact.startFrame >= contact.endFrame) {
        ctx.addIssue({ code: "custom", message: `${contact.contactId}: 빈 구간` });
      }
      known(contact.a.subjectId, contact.contactId);
      known(contact.b.subjectId, contact.contactId);
    }
    for (const override of preview.overrides) {
      known(override.subjectId, override.contactId);
      if (!preview.contacts.some((contact) => contact.contactId === override.contactId)) {
        ctx.addIssue({ code: "custom", message: `${override.contactId}: 원본 접촉이 없음` });
      }
    }
  });

export type InteractionPreviewRecord = z.infer<typeof interactionPreviewSchema>;
