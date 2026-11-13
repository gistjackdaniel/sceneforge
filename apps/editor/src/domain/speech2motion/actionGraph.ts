import { z } from "zod";

/**
 * Speech2motion Action Graph JSON 계약 v0.1.
 *
 * Agentic 레인(producer)이 만들고 Video 레인(consumer)이 읽는다.
 * 이 모듈은 스키마 검증만 담당한다. 모션 생성, IK, 렌더, UI 상태는 바꾸지 않는다.
 */

// TODO: World 레인의 rigPartSchema(left_hand, right_hand, left_foot, right_foot, head, pelvis)와 합칠 예정.
export const rigPartSchema = z.enum([
  "left_hand",
  "right_hand",
  "left_foot",
  "right_foot",
  "head",
  "pelvis",
]);
export type RigPart = z.infer<typeof rigPartSchema>;

const idSchema = z.string().min(1);

interface RefinementCtx {
  addIssue(issue: {
    code: "custom";
    message: string;
    path: PropertyKey[];
    params: { rule: string };
    continue: true;
  }): void;
}

function addIssue(ctx: RefinementCtx, path: PropertyKey[], message: string, rule: string): void {
  ctx.addIssue({
    code: "custom",
    continue: true,
    path,
    message,
    params: { rule },
  });
}

function refineIntegerFrame(value: number, path: PropertyKey[], ctx: RefinementCtx): void {
  if (!Number.isInteger(value)) {
    addIssue(ctx, path, "시간은 정수 프레임이어야 합니다.", "integer_frame");
  }
}

function refineFrameSpan(span: { start_frame: number; end_frame: number }, ctx: RefinementCtx): void {
  refineIntegerFrame(span.start_frame, ["start_frame"], ctx);
  refineIntegerFrame(span.end_frame, ["end_frame"], ctx);
  if (span.start_frame > span.end_frame) {
    addIssue(ctx, ["end_frame"], "시작 프레임은 끝 프레임보다 작거나 같아야 합니다.", "frame_order");
  }
}

export const FrameRangeSchema = z
  .object({
    start_frame: z.number(),
    end_frame: z.number(),
  })
  .superRefine((range, ctx) => {
    refineFrameSpan(range, ctx);
  });
export type FrameRange = z.infer<typeof FrameRangeSchema>;

export const ClarificationSchema = z.object({
  clarification_id: idSchema,
  question: z.string().min(1),
  entity_ref: idSchema.optional(),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const ActorSchema = z.object({
  actor_id: idSchema,
  rig: z.literal("smplx"),
  speaker_id: idSchema.optional(),
  style_ref: idSchema.optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const UtteranceSchema = z
  .object({
    utterance_id: idSchema,
    actor_id: idSchema,
    audio_ref: idSchema,
    start_frame: z.number(),
    end_frame: z.number(),
    transcript: z.string(),
  })
  .superRefine((utterance, ctx) => {
    refineFrameSpan(utterance, ctx);
  });
export type Utterance = z.infer<typeof UtteranceSchema>;

export const RelationSchema = z.object({
  type: z.enum(["before", "after", "while"]),
  ref_event_id: idSchema,
  offset_frames: z.number(),
});
export type Relation = z.infer<typeof RelationSchema>;

export const TrajectoryPointSchema = z.object({
  frame: z.number(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  heading: z.number().optional(),
});
export type TrajectoryPoint = z.infer<typeof TrajectoryPointSchema>;

export const TrajectoryConditionSchema = z.object({
  space: z.literal("world"),
  points: z.array(TrajectoryPointSchema),
});
export type TrajectoryCondition = z.infer<typeof TrajectoryConditionSchema>;

export const EventSchema = z
  .object({
    event_id: idSchema,
    actor_id: idSchema,
    action_type: z.string().min(1),
    utterance_id: idSchema.optional(),
    start_frame: z.number(),
    end_frame: z.number(),
    relation: RelationSchema.optional(),
    text_condition: z.string().optional(),
    trajectory_condition: TrajectoryConditionSchema.optional(),
    contact_ids: z.array(idSchema).optional(),
  })
  .superRefine((event, ctx) => {
    refineFrameSpan(event, ctx);
    if (event.relation) {
      refineIntegerFrame(event.relation.offset_frames, ["relation", "offset_frames"], ctx);
    }
    event.trajectory_condition?.points.forEach((point, index) => {
      refineIntegerFrame(point.frame, ["trajectory_condition", "points", index, "frame"], ctx);
    });
  });
export type Event = z.infer<typeof EventSchema>;

export const ContactEndpointASchema = z.object({
  actor_id: idSchema,
  part: rigPartSchema,
});
export type ContactEndpointA = z.infer<typeof ContactEndpointASchema>;

export const ContactEndpointBSchema = z.object({
  actor_id: idSchema.optional(),
  object_id: idSchema.optional(),
  part: rigPartSchema.optional(),
});
export type ContactEndpointB = z.infer<typeof ContactEndpointBSchema>;

export const ContactGraphSchema = z
  .object({
    contact_id: idSchema,
    a: ContactEndpointASchema,
    b: ContactEndpointBSchema,
    start_frame: z.number(),
    end_frame: z.number(),
    type: z.enum(["grasp", "strike", "support", "place"]),
    impulse_N_s: z.number().nullable().optional(),
  })
  .superRefine((contact, ctx) => {
    refineFrameSpan(contact, ctx);
    const hasActor = contact.b.actor_id !== undefined;
    const hasObject = contact.b.object_id !== undefined;
    if (hasActor === hasObject) {
      addIssue(ctx, ["b"], "b에는 actor_id와 object_id 중 하나만 있어야 합니다.", "contact_target");
    }
    if (hasActor && contact.b.part === undefined) {
      addIssue(ctx, ["b", "part"], "b.actor_id가 있으면 b.part가 있어야 합니다.", "contact_part_required");
    }
  });
export type ContactGraph = z.infer<typeof ContactGraphSchema>;

export const EditSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("camera_track"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("root_motion"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("motion"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("contact_constraints"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("set_layout"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("background"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("render_passes"), actor_id: idSchema.optional() }),
  z.object({ kind: z.literal("contact"), contact_id: idSchema }),
]);
export type EditSelector = z.infer<typeof EditSelectorSchema>;

function selectorKey(selector: EditSelector): string {
  if (selector.kind === "contact") {
    return JSON.stringify(["contact", selector.contact_id]);
  }
  return JSON.stringify([selector.kind, selector.actor_id ?? null]);
}

function refineEdit(
  edit: { preserve: readonly EditSelector[]; recompute: readonly EditSelector[] },
  ctx: RefinementCtx,
): void {
  const recomputeKeys = new Set(edit.recompute.map(selectorKey));
  edit.preserve.forEach((selector, index) => {
    if (recomputeKeys.has(selectorKey(selector))) {
      addIssue(ctx, ["preserve", index], "같은 항목이 preserve와 recompute에 함께 들어 있습니다.", "selector_overlap");
    }
  });

  for (const listName of ["preserve", "recompute"] as const) {
    edit[listName].forEach((selector, index) => {
      if ((selector.kind === "root_motion" || selector.kind === "motion") && selector.actor_id === undefined) {
        addIssue(
          ctx,
          [listName, index, "actor_id"],
          `${selector.kind}에는 actor_id가 있어야 합니다.`,
          "actor_required",
        );
      }
    });
  }
}

export const EditSourceSchema = z.object({
  type: z.enum(["voice", "text", "manual"]),
  transcript: z.string().optional(),
});
export type EditSource = z.infer<typeof EditSourceSchema>;

export const EditSchema = z
  .object({
    edit_id: idSchema,
    base_graph_version: idSchema,
    operation: z.string().min(1),
    source: EditSourceSchema,
    preserve: z.array(EditSelectorSchema),
    recompute: z.array(EditSelectorSchema),
  })
  .superRefine((edit, ctx) => {
    refineEdit(edit, ctx);
  });
export type Edit = z.infer<typeof EditSchema>;

interface ReferenceGraph {
  actors: readonly { actor_id: string }[];
  utterances: readonly { utterance_id: string; actor_id: string }[];
  events: readonly {
    event_id: string;
    actor_id: string;
    utterance_id?: string;
    relation?: { ref_event_id: string };
    contact_ids?: readonly string[];
  }[];
  contact_graph: readonly {
    contact_id: string;
    a: { actor_id: string };
    b: { actor_id?: string };
  }[];
  edit?: {
    preserve: readonly EditSelector[];
    recompute: readonly EditSelector[];
  };
}

function refineSelectorReferences(
  selectors: readonly EditSelector[],
  listName: "preserve" | "recompute",
  actorIds: ReadonlySet<string>,
  contactIds: ReadonlySet<string>,
  ctx: RefinementCtx,
): void {
  selectors.forEach((selector, index) => {
    if (selector.kind === "contact") {
      if (!contactIds.has(selector.contact_id)) {
        addIssue(
          ctx,
          ["edit", listName, index, "contact_id"],
          `contact_id "${selector.contact_id}"가 contact_graph에 없습니다.`,
          "unknown_contact",
        );
      }
      return;
    }
    if (selector.actor_id !== undefined && !actorIds.has(selector.actor_id)) {
      addIssue(
        ctx,
        ["edit", listName, index, "actor_id"],
        `actor_id "${selector.actor_id}"가 actors에 없습니다.`,
        "unknown_actor",
      );
    }
  });
}

function refineReferences(graph: ReferenceGraph, ctx: RefinementCtx): void {
  const actorIds = new Set(graph.actors.map((actor) => actor.actor_id));
  const utteranceIds = new Set(graph.utterances.map((utterance) => utterance.utterance_id));
  const eventIds = new Set(graph.events.map((event) => event.event_id));
  const contactIds = new Set(graph.contact_graph.map((contact) => contact.contact_id));

  graph.utterances.forEach((utterance, index) => {
    if (!actorIds.has(utterance.actor_id)) {
      addIssue(
        ctx,
        ["utterances", index, "actor_id"],
        `actor_id "${utterance.actor_id}"가 actors에 없습니다.`,
        "unknown_actor",
      );
    }
  });

  graph.events.forEach((event, index) => {
    if (!actorIds.has(event.actor_id)) {
      addIssue(ctx, ["events", index, "actor_id"], `actor_id "${event.actor_id}"가 actors에 없습니다.`, "unknown_actor");
    }
    if (event.utterance_id !== undefined && !utteranceIds.has(event.utterance_id)) {
      addIssue(
        ctx,
        ["events", index, "utterance_id"],
        `utterance_id "${event.utterance_id}"가 utterances에 없습니다.`,
        "unknown_utterance",
      );
    }
    if (event.relation && !eventIds.has(event.relation.ref_event_id)) {
      addIssue(
        ctx,
        ["events", index, "relation", "ref_event_id"],
        `ref_event_id "${event.relation.ref_event_id}"가 events에 없습니다.`,
        "unknown_event",
      );
    }
    event.contact_ids?.forEach((contactId, contactIndex) => {
      if (!contactIds.has(contactId)) {
        addIssue(
          ctx,
          ["events", index, "contact_ids", contactIndex],
          `contact_id "${contactId}"가 contact_graph에 없습니다.`,
          "unknown_contact",
        );
      }
    });
  });

  graph.contact_graph.forEach((contact, index) => {
    if (!actorIds.has(contact.a.actor_id)) {
      addIssue(
        ctx,
        ["contact_graph", index, "a", "actor_id"],
        `actor_id "${contact.a.actor_id}"가 actors에 없습니다.`,
        "unknown_actor",
      );
    }
    if (contact.b.actor_id !== undefined && !actorIds.has(contact.b.actor_id)) {
      addIssue(
        ctx,
        ["contact_graph", index, "b", "actor_id"],
        `actor_id "${contact.b.actor_id}"가 actors에 없습니다.`,
        "unknown_actor",
      );
    }
  });

  if (graph.edit) {
    refineSelectorReferences(graph.edit.preserve, "preserve", actorIds, contactIds, ctx);
    refineSelectorReferences(graph.edit.recompute, "recompute", actorIds, contactIds, ctx);
  }
}

export const ActionGraphSchema = z
  .object({
    schema_version: z.literal("0.1"),
    graph_version: idSchema,
    shot_id: idSchema,
    // Shot fps. 양수이며 30으로 고정하지 않는다. 모델 fps 리샘플은 Video 레인 책임이다.
    fps: z.number().positive(),
    frame_range: FrameRangeSchema,
    status: z.enum(["ready", "needs_clarification"]),
    clarifications: z.array(ClarificationSchema),
    actors: z.array(ActorSchema),
    utterances: z.array(UtteranceSchema),
    events: z.array(EventSchema),
    contact_graph: z.array(ContactGraphSchema),
    edit: EditSchema.optional(),
  })
  .superRefine((graph, ctx) => {
    refineReferences(graph, ctx);
  });
export type ActionGraph = z.infer<typeof ActionGraphSchema>;

export interface ActionGraphIssue {
  path: Array<string | number>;
  message: string;
  /**
   * 계약 규칙 id. 형태가 맞지 않으면 Zod issue code(`invalid_type` 등)를 그대로 둔다.
   */
  code: string;
}

export type ActionGraphReadyResult =
  | { ok: true; graph: ActionGraph }
  | { ok: false; errors: ActionGraphIssue[] };

function issuePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.flatMap((segment) => (typeof segment === "string" || typeof segment === "number" ? [segment] : []));
}

function toActionGraphIssue(issue: {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
  params?: Record<string, unknown>;
}): ActionGraphIssue {
  const rule = typeof issue.params?.rule === "string" ? issue.params.rule : issue.code;
  return {
    path: issuePath(issue.path),
    message: issue.message,
    code: rule && rule.length > 0 ? rule : "custom",
  };
}

/**
 * Video 레인이 실행 가능한 Action Graph만 받아들이는 진입점.
 *
 * `ActionGraphSchema`는 `needs_clarification`을 계약 값으로 허용한다.
 * 이 함수는 `status === "ready"`인 그래프만 성공으로 돌려주고, 그 외에는 구조화된 `errors`를 반환한다.
 * 예외를 던지지 않는다. 캐시, Project, 렌더 큐에 부수 효과가 없다.
 */
export class ActionGraphValidator {
  private constructor() {}

  static parseReady(input: unknown): ActionGraphReadyResult {
    const parsed = ActionGraphSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(toActionGraphIssue) };
    }
    if (parsed.data.status !== "ready") {
      return {
        ok: false,
        errors: [
          {
            path: ["status"],
            message: 'status가 "needs_clarification"인 그래프는 Video 레인에서 받지 않습니다.',
            code: "needs_clarification",
          },
        ],
      };
    }
    return { ok: true, graph: parsed.data };
  }
}
