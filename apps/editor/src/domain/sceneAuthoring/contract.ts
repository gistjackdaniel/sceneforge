import { z } from "zod";
import type { Quat, Vec3 } from "./math";

/**
 * Viewport가 읽는 상호작용 장면.
 *
 * Video 레인이 SMPL-X pose sequence를 채우고, Agentic 레인의 Action Graph v0.1이
 * contact를 만든다. 이 모듈은 그 둘을 생성하지 않는다. fixture가 같은 모양을 넣어
 * 프리뷰와 편집 범위를 증명한다.
 *
 * 대상 참조는 `worldAssetId`(WorldAsset.id)만 쓴다. `instanceId`는 불투명하다.
 * World 레인의 ActorInstance / ObjectInstance id가 정해지면 `rebindInstanceIds`로
 * 갈아 끼운다. id 문자열을 파싱하지 않는다.
 *
 * 좌표계: 오른손, +Y up, 미터, 회전은 쿼터니언 [x, y, z, w].
 * 접촉 구간은 shot-local [start, end). Action Graph의 end_frame은 닫힌 구간이라
 * 어댑터에서 +1 한다.
 */

export const SCENE_PLAYBACK_CONTRACT = {
  handedness: "right",
  upAxis: "Y",
  forwardAxis: "+Z",
  unit: "meter",
  rotationStorage: "quaternion_xyzw",
  timeBase: "shot_local_frame",
} as const;

export const rigPartSchema = z.enum([
  "left_hand",
  "right_hand",
  "left_foot",
  "right_foot",
  "head",
  "pelvis",
]);
export type RigPart = z.infer<typeof rigPartSchema>;

/** Proxy joint used until SMPL-X joint names arrive. Same semantic map as the World draft. */
export const PROXY_PART_JOINT: Record<RigPart, string> = {
  left_hand: "left_wrist",
  right_hand: "right_wrist",
  left_foot: "left_ankle",
  right_foot: "right_ankle",
  head: "head",
  pelvis: "pelvis",
};

const finite = z.number().finite();
export const vec3Schema = z.tuple([finite, finite, finite]);
export const quatSchema = z
  .tuple([finite, finite, finite, finite])
  .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-4, "단위 쿼터니언이 아님");

export const transformSchema = z.object({
  translation: vec3Schema,
  rotation: quatSchema,
});
export type Transform = { translation: Vec3; rotation: Quat };

export const subjectBindingSchema = z.object({
  worldAssetId: z.string().min(1),
  instanceId: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["actor", "object"]),
  color: z.string().min(1),
});
export type SubjectBinding = z.infer<typeof subjectBindingSchema>;

export const rootSampleSchema = z.object({
  frame: z.number().int().nonnegative(),
  translation: vec3Schema,
  rotation: quatSchema,
});
export type RootSample = { frame: number; translation: Vec3; rotation: Quat };

export const rotationKeySchema = z.object({
  frame: z.number().int().nonnegative(),
  rotation: quatSchema,
});
export type RotationKey = { frame: number; rotation: Quat };

/**
 * One authored joint-rotation channel.
 * `contactId`가 있으면 그 접촉의 해결된 effector 쪽으로 채널이 옮겨 간다.
 * 원본 `rigPart`는 바꾸지 않는다.
 */
export const poseChannelSchema = z.object({
  id: z.string().min(1),
  actorInstanceId: z.string().min(1),
  rigPart: rigPartSchema,
  contactId: z.string().min(1).optional(),
  joints: z.record(z.string(), z.array(rotationKeySchema)),
});
export type PoseChannel = {
  id: string;
  actorInstanceId: string;
  rigPart: RigPart;
  contactId?: string;
  joints: Record<string, RotationKey[]>;
};

export const actorPoseClipSchema = z.object({
  instanceId: z.string().min(1),
  root: z.array(rootSampleSchema).min(1),
  channels: z.array(poseChannelSchema),
});
export type ActorPoseClip = {
  instanceId: string;
  root: RootSample[];
  channels: PoseChannel[];
};

export const contactKindSchema = z.enum(["hand_hand", "hand_object", "object_surface"]);
export type ContactKind = z.infer<typeof contactKindSchema>;

export const contactEndpointSchema = z.object({
  instanceId: z.string().min(1),
  rigPart: rigPartSchema.optional(),
});
export type ContactEndpoint = { instanceId: string; rigPart?: RigPart };

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

export const attachmentSpanSchema = z.object({
  objectInstanceId: z.string().min(1),
  parentInstanceId: z.string().min(1),
  rigPart: rigPartSchema.optional(),
  offset: transformSchema,
  frameRange: z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
  sourceContactId: z.string().min(1).optional(),
});
export type AttachmentSpan = {
  objectInstanceId: string;
  parentInstanceId: string;
  rigPart?: RigPart;
  offset: Transform;
  frameRange: [number, number];
  sourceContactId?: string;
};

export const objectRestSchema = z.object({
  instanceId: z.string().min(1),
  worldAssetId: z.string().min(1),
  role: z.enum(["prop", "set_piece"]),
  motionMode: z.enum(["static", "keyframed", "dynamic"]),
  rest: transformSchema.extend({
    scale: vec3Schema.default([1, 1, 1]),
  }),
  /** contactId → parent-local offset. Attachment is rebuilt from contacts, not stored as truth. */
  attachmentOffsets: z.record(z.string(), transformSchema).default({}),
});
export type ObjectRest = {
  instanceId: string;
  worldAssetId: string;
  role: "prop" | "set_piece";
  motionMode: "static" | "keyframed" | "dynamic";
  rest: { translation: Vec3; rotation: Quat; scale: Vec3 };
  attachmentOffsets: Record<string, Transform>;
};

export const cameraSampleSchema = z.object({
  frame: z.number().int().nonnegative(),
  position: vec3Schema,
  rotation: quatSchema,
});
export type CameraSample = { frame: number; position: Vec3; rotation: Quat };

export const contactEffectorOverrideSchema = z.object({
  contactId: z.string().min(1),
  worldAssetId: z.string().min(1),
  instanceId: z.string().min(1),
  rigPart: rigPartSchema,
});
export type ContactEffectorOverride = z.infer<typeof contactEffectorOverrideSchema>;

export const interactiveSceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    worldAssetId: z.string().min(1),
    fps: z.number().positive(),
    frameCount: z.number().int().positive(),
    subjects: z.array(subjectBindingSchema).min(1),
    poses: z.array(actorPoseClipSchema),
    objects: z.array(objectRestSchema),
    contacts: z.array(contactEventSchema),
    camera: z.object({
      cameraTrackId: z.string().min(1),
      samples: z.array(cameraSampleSchema).min(1),
    }),
    overrides: z.array(contactEffectorOverrideSchema).default([]),
  })
  .superRefine((scene, ctx) => {
    const instanceIds = new Set<string>();
    for (const subject of scene.subjects) {
      if (instanceIds.has(subject.instanceId)) {
        ctx.addIssue({ code: "custom", message: `instance id 중복: ${subject.instanceId}` });
      }
      instanceIds.add(subject.instanceId);
    }
    const known = (id: string, path: string) => {
      if (!instanceIds.has(id)) ctx.addIssue({ code: "custom", message: `${path}: 없는 instance ${id}` });
    };
    for (const pose of scene.poses) known(pose.instanceId, "poses");
    for (const object of scene.objects) known(object.instanceId, "objects");
    for (const contact of scene.contacts) {
      if (contact.startFrame >= contact.endFrame) {
        ctx.addIssue({ code: "custom", message: `${contact.contactId}: 빈 구간` });
      }
      known(contact.a.instanceId, contact.contactId);
      known(contact.b.instanceId, contact.contactId);
    }
    for (const channel of scene.poses.flatMap((pose) => pose.channels)) known(channel.actorInstanceId, channel.id);
    for (const override of scene.overrides) {
      known(override.instanceId, override.contactId);
      if (!scene.contacts.some((contact) => contact.contactId === override.contactId)) {
        ctx.addIssue({ code: "custom", message: `${override.contactId}: 원본 접촉이 없음` });
      }
    }
  });

export type InteractiveScene = z.infer<typeof interactiveSceneSchema>;

/**
 * Fields the viewport reads from an Action Graph v0.1 contact row.
 * The Agentic schema is not imported here (PR #23). Names match that contract.
 */
export const actionGraphContactSchema = z
  .object({
    contact_id: z.string().min(1),
    a: z.object({ actor_id: z.string().min(1), part: rigPartSchema }),
    b: z.object({
      actor_id: z.string().min(1).optional(),
      object_id: z.string().min(1).optional(),
      part: rigPartSchema.optional(),
    }),
    start_frame: z.number().int(),
    end_frame: z.number().int(),
    type: z.enum(["grasp", "strike", "support", "place"]),
  })
  .superRefine((row, ctx) => {
    const hasActor = row.b.actor_id !== undefined;
    const hasObject = row.b.object_id !== undefined;
    if (hasActor === hasObject) {
      ctx.addIssue({ code: "custom", message: "b에는 actor_id와 object_id 중 하나만 있어야 합니다." });
    }
    if (hasActor && row.b.part === undefined) {
      ctx.addIssue({ code: "custom", message: "b.actor_id가 있으면 b.part가 있어야 합니다." });
    }
    if (row.start_frame > row.end_frame) {
      ctx.addIssue({ code: "custom", message: "start_frame이 end_frame보다 큽니다." });
    }
  });
export type ActionGraphContact = z.infer<typeof actionGraphContactSchema>;
