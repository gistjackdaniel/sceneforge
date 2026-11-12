import { createWorldTargetResolver, type MentionResolution } from "../worlds/query";
import type { SceneState } from "../worlds/sceneState";
import type { WorldAsset } from "../worlds/types";
import type { RigPart as WorldRigPart } from "../worlds/sceneState";
import { createTextAsrStub, type AsrEngine, type AsrLocale } from "./asr";
import {
  ActionGraphSchema,
  type ActionGraph,
  type EditSelector,
  type Relation,
  type TrajectoryCondition,
} from "./actionGraph";
import { parseDirection, type DirectionAction, type DirectionStep, type HandSpec, type TemporalType } from "./parseDirection";

/**
 * Seconds become frames only through this clock.
 * The application layer passes `toFrame` and a fps chosen from Shot, then Sequence, then the clip default.
 */
export type FrameClock = {
  fps: number;
  toFrame: (tSeconds: number, fps: number) => number;
};

export type Speech2MotionInput = {
  text?: string;
  locale?: AsrLocale;
  /** Refused by the text stub. Kept on the request so a model is not implied. */
  audio?: unknown;
  shotId: string;
  clock: FrameClock;
  worlds: Record<string, WorldAsset>;
  sceneStates?: Record<string, SceneState>;
  selectionIds?: string[];
  /** Ready graph an edit utterance modifies. The producer returns a new graph and does not mutate this one. */
  baseGraph?: ActionGraph;
  /** Shot length in frames. The graph range grows when the action runs longer. */
  durationFrames?: number;
  source?: "voice" | "text" | "manual";
  asr?: AsrEngine;
};

type Vec3 = [number, number, number];

/** Hand height above an actor root when the scene has no joint world pose. Meters, Y-up. */
export const STANDING_HAND_HEIGHT_M = 1.1;

const DEFAULT_CONTACT_PART: WorldRigPart = "right_hand";

type Ask = { question: string };

const framesOf = (clock: FrameClock, seconds: number): number => clock.toFrame(seconds, clock.fps);

const clarificationGraph = (input: Speech2MotionInput, asks: Ask[]): ActionGraph =>
  ActionGraphSchema.parse({
    schema_version: "0.1",
    graph_version: "0",
    shot_id: input.shotId,
    fps: input.clock.fps,
    frame_range: { start_frame: 0, end_frame: 0 },
    status: "needs_clarification",
    clarifications: asks.map((ask, index) => ({
      clarification_id: `clarify_${index + 1}`,
      question: ask.question,
    })),
    actors: [],
    utterances: [],
    events: [],
    contact_graph: [],
  });

const bumpVersion = (version: string): string => (/^\d+$/.test(version) ? String(Number(version) + 1) : `${version}-edit`);

const translationOf = (scenes: Record<string, SceneState> | undefined, id: string): Vec3 | undefined => {
  for (const scene of Object.values(scenes ?? {})) {
    const actor = scene.actors[id];
    if (actor && !actor.deletedAt) {
      const [x, y, z] = actor.restTransform.translation;
      return [x, y, z];
    }
    const object = scene.objects[id];
    if (object && !object.deletedAt) {
      const [x, y, z] = object.restTransform.translation;
      return [x, y, z];
    }
  }
  return undefined;
};

const handPoint = (scenes: Record<string, SceneState> | undefined, id: string): Vec3 => {
  const root = translationOf(scenes, id) ?? [0, 0, 0];
  return [root[0], root[1] + STANDING_HAND_HEIGHT_M, root[2]];
};

const midpoint = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

const headingOf = (from: Vec3, to: Vec3): number | undefined => {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.hypot(dx, dz) < 1e-6) return undefined;
  return Math.atan2(dx, dz);
};

const trajectory = (startFrame: number, endFrame: number, start: Vec3, end: Vec3): TrajectoryCondition => {
  const heading = headingOf(start, end);
  return {
    space: "world",
    points: [
      { frame: startFrame, position: start, ...(heading !== undefined ? { heading } : {}) },
      { frame: endFrame, position: end },
    ],
  };
};

const contactPart = (hand: HandSpec): WorldRigPart | undefined => {
  if (hand.count > 1) return undefined;
  return hand.rigPart ?? DEFAULT_CONTACT_PART;
};

const askFor = (mention: string, result: MentionResolution): Ask => {
  if (result.status === "ambiguous") {
    const names = result.candidates.map((candidate) => candidate.displayName).join(", ");
    return { question: `${names} 가운데 어느 것인가요?` };
  }
  return { question: `${mention}에 해당하는 대상을 찾지 못했습니다.` };
};

const selectorKey = (selector: EditSelector): string =>
  selector.kind === "contact" ? `contact:${selector.contact_id}` : `${selector.kind}:${selector.actor_id ?? ""}`;

const disjoint = (preserve: EditSelector[], recompute: EditSelector[]): boolean => {
  const keys = new Set(preserve.map(selectorKey));
  return recompute.every((selector) => !keys.has(selectorKey(selector)));
};

type Span = {
  start: number;
  end: number;
  relation?: { type: TemporalType; refStep: number; offsetFrames: number };
};

const schedule = (steps: DirectionStep[], clock: FrameClock): Span[] => {
  const duration = (step: DirectionStep): number => framesOf(clock, step.durationSeconds);
  if (steps.length < 2 || !steps[1]?.relation) {
    return steps.map((step) => ({ start: 0, end: duration(step) }));
  }
  const first = steps[0]!;
  const second = steps[1]!;
  const relation = second.relation!;
  const leading = duration(first);
  const following = duration(second);
  const gap = framesOf(clock, Math.abs(relation.offsetSeconds));
  if (relation.type === "before") {
    return [
      { start: following + gap, end: following + gap + leading },
      { start: 0, end: following, relation: { type: "before", refStep: 0, offsetFrames: -gap } },
    ];
  }
  if (relation.type === "while") {
    return [
      { start: 0, end: leading },
      { start: gap, end: gap + following, relation: { type: "while", refStep: 0, offsetFrames: gap } },
    ];
  }
  const start = leading + gap;
  return [
    { start: 0, end: leading },
    { start, end: start + following, relation: { type: "after", refStep: 0, offsetFrames: gap } },
  ];
};

const actorMentions = (action: DirectionAction): string[] => {
  if (action.kind === "handshake") return action.actors;
  return [action.actor];
};

/**
 * Text utterance → Action Graph v0.1.
 * Pure: the input objects are not mutated, and nothing is written to a project.
 * `status: "needs_clarification"` is a schema-valid graph. Video accepts only `parseReady`.
 */
export const produceSpeech2Motion = (input: Speech2MotionInput): ActionGraph => {
  if (!(input.clock.fps > 0) || !Number.isFinite(input.clock.fps)) {
    throw new Error("speech2motion fps must be a positive number.");
  }
  const asr = (input.asr ?? createTextAsrStub()).transcribe({
    text: input.text,
    locale: input.locale,
    audio: input.audio,
  });
  if (!asr.ok) {
    const question = asr.reason === "audio_unsupported"
      ? "텍스트 발화가 필요합니다. 오디오는 받아 적지 않습니다."
      : "발화가 비어 있습니다.";
    return clarificationGraph(input, [{ question }]);
  }
  const transcript = asr.transcript.text;
  const direction = parseDirection(transcript);
  if (direction.type === "unknown") {
    return clarificationGraph(input, [{ question: "이 발화를 동작으로 해석하지 못했습니다." }]);
  }
  if (direction.type === "edit_contact_hand") {
    return editContactHand(input, transcript, direction.actor, direction.hand);
  }
  return produceSequence(input, transcript, direction.steps);
};

const editContactHand = (input: Speech2MotionInput, transcript: string, actorMention: string, hand: HandSpec): ActionGraph => {
  if (!input.baseGraph) {
    return clarificationGraph(input, [{ question: "수정할 동작 그래프가 없습니다." }]);
  }
  if (input.baseGraph.status !== "ready") {
    return clarificationGraph(input, [{ question: "아직 확정되지 않은 동작 그래프는 수정할 수 없습니다." }]);
  }
  if (input.baseGraph.shot_id !== input.shotId) {
    return clarificationGraph(input, [{ question: "수정 대상 샷이 기준 그래프와 다릅니다." }]);
  }
  if (hand.count > 1) {
    return clarificationGraph(input, [{ question: "어느 손인가요?" }]);
  }
  const resolver = createWorldTargetResolver(input.worlds, input.sceneStates);
  const resolved = resolver.resolveMention(actorMention, {
    selectionIds: input.selectionIds ?? [],
    locale: input.locale ?? "ko",
    entityKind: "actor",
  });
  if (resolved.status !== "resolved") return clarificationGraph(input, [askFor(actorMention, resolved)]);
  const actorId = resolved.persistentId;
  const contacts = input.baseGraph.contact_graph.filter(
    (contact) => contact.a.actor_id === actorId || contact.b.actor_id === actorId,
  );
  if (contacts.length === 0) {
    return clarificationGraph(input, [{ question: `${resolved.displayName}의 접촉을 찾지 못했습니다.` }]);
  }
  if (contacts.length > 1) {
    return clarificationGraph(input, [{ question: `${resolved.displayName}의 접촉이 둘 이상입니다. 어느 접촉인가요?` }]);
  }
  const contact = contacts[0]!;
  const recompute: EditSelector[] = [
    { kind: "motion", actor_id: actorId },
    { kind: "contact_constraints", actor_id: actorId },
    { kind: "contact", contact_id: contact.contact_id },
  ];
  const preserve: EditSelector[] = [];
  for (const actor of input.baseGraph.actors) {
    if (actor.actor_id !== actorId) preserve.push({ kind: "motion", actor_id: actor.actor_id });
    preserve.push({ kind: "root_motion", actor_id: actor.actor_id });
  }
  preserve.push({ kind: "camera_track" }, { kind: "set_layout" }, { kind: "background" });
  for (const other of input.baseGraph.contact_graph) {
    if (other.contact_id !== contact.contact_id) preserve.push({ kind: "contact", contact_id: other.contact_id });
  }
  if (!disjoint(preserve, recompute)) {
    return clarificationGraph(input, [{ question: "보존 항목과 다시 계산할 항목이 겹칩니다." }]);
  }
  const nextVersion = bumpVersion(input.baseGraph.graph_version);
  return ActionGraphSchema.parse({
    ...input.baseGraph,
    graph_version: nextVersion,
    status: "ready",
    clarifications: [],
    edit: {
      edit_id: `edit_${nextVersion}`,
      base_graph_version: input.baseGraph.graph_version,
      operation: "edit_contact_hand",
      source: { type: input.source ?? "text", transcript },
      preserve,
      recompute,
    },
  });
};

const produceSequence = (input: Speech2MotionInput, transcript: string, steps: DirectionStep[]): ActionGraph => {
  const asks: Ask[] = [];
  for (const step of steps) {
    const hand = "hand" in step.action ? step.action.hand : undefined;
    if (hand && hand.count > 1) asks.push({ question: "어느 손인가요?" });
  }
  const resolver = createWorldTargetResolver(input.worlds, input.sceneStates);
  const ctx = { selectionIds: input.selectionIds ?? [], locale: input.locale ?? "ko" };
  const resolveCache = new Map<string, string | undefined>();
  const resolve = (mention: string, entityKind: "actor" | "object"): string | undefined => {
    const key = `${entityKind}:${mention}`;
    if (resolveCache.has(key)) return resolveCache.get(key);
    if (!mention) {
      asks.push({ question: "대상 이름이 비어 있습니다." });
      resolveCache.set(key, undefined);
      return undefined;
    }
    const hit = resolver.resolveMention(mention, { ...ctx, entityKind });
    if (hit.status !== "resolved") {
      asks.push(askFor(mention, hit));
      resolveCache.set(key, undefined);
      return undefined;
    }
    resolveCache.set(key, hit.persistentId);
    return hit.persistentId;
  };

  const partnerMention = (step: DirectionStep, named: string): string | undefined => {
    for (const other of steps) {
      if (other === step || other.action.kind === "place") continue;
      const candidate = actorMentions(other.action).find((mention) => mention !== named);
      if (candidate) return candidate;
    }
    return undefined;
  };

  type HandshakeCast = { left: string; right: string; part: WorldRigPart; phrase: string; span: Span };
  type PlaceCast = { actor: string; objectId: string; surfaceId?: string; part: WorldRigPart; phrase: string; span: Span };
  type ApproachCast = { actor: string; phrase: string; span: Span; toward?: string };
  const handshakes: HandshakeCast[] = [];
  const places: PlaceCast[] = [];
  const approaches: ApproachCast[] = [];
  const spans = schedule(steps, input.clock);
  for (const step of steps) {
    for (const mention of actorMentions(step.action)) resolve(mention, "actor");
    if (step.action.kind === "place") {
      resolve(step.action.object, "object");
      if (step.action.surface) resolve(step.action.surface, "object");
    }
  }

  steps.forEach((step, index) => {
    const span = spans[index] ?? { start: 0, end: framesOf(input.clock, step.durationSeconds) };
    if (step.action.kind === "handshake") {
      const named = step.action.actors.length >= 2 ? step.action.actors : [step.action.actors[0] ?? ""];
      const pair = step.action.actors.length >= 2
        ? [step.action.actors[0] ?? "", step.action.actors[1] ?? ""]
        : [partnerMention(step, named[0] ?? "") ?? "", named[0] ?? ""];
      const left = resolve(pair[0] ?? "", "actor");
      const right = resolve(pair[1] ?? "", "actor");
      const part = contactPart(step.action.hand);
      if (!part) return;
      if (!left || !right || left === right) {
        if (left && right && left === right) asks.push({ question: "악수할 두 사람이 같지 않아야 합니다." });
        else if (!pair[0]) asks.push({ question: "악수할 상대를 찾지 못했습니다." });
        return;
      }
      handshakes.push({ left, right, part, phrase: step.phrase, span });
      return;
    }
    if (step.action.kind === "place") {
      const actor = resolve(step.action.actor, "actor");
      const objectId = resolve(step.action.object, "object");
      const surfaceId = step.action.surface ? resolve(step.action.surface, "object") : undefined;
      const part = contactPart(step.action.hand);
      if (!part || !actor || !objectId) return;
      places.push({ actor, objectId, ...(surfaceId ? { surfaceId } : {}), part, phrase: step.phrase, span });
      return;
    }
    const actor = resolve(step.action.actor, "actor");
    if (!actor) return;
    const toward = steps
      .filter((other) => other !== step)
      .flatMap((other) => actorMentions(other.action))
      .map((mention) => resolveCache.get(`actor:${mention}`))
      .find((id) => id && id !== actor);
    approaches.push({ actor, phrase: step.phrase, span, ...(toward ? { toward } : {}) });
  });

  if (asks.length > 0) return clarificationGraph(input, asks);
  if (handshakes.length === 0 && places.length === 0 && approaches.length === 0) {
    return clarificationGraph(input, [{ question: "이 발화를 동작으로 해석하지 못했습니다." }]);
  }

  const actorIds: string[] = [];
  const remember = (id: string) => {
    if (!actorIds.includes(id)) actorIds.push(id);
  };
  for (const handshake of handshakes) {
    remember(handshake.left);
    remember(handshake.right);
  }
  for (const place of places) remember(place.actor);
  for (const approach of approaches) remember(approach.actor);

  type DraftEvent = {
    event_id: string;
    actor_id: string;
    action_type: string;
    start_frame: number;
    end_frame: number;
    text_condition: string;
    relation?: Relation;
    trajectory_condition?: TrajectoryCondition;
    contact_ids?: string[];
    primaryOf?: number;
  };

  const events: DraftEvent[] = [];
  const primaryEventId = new Map<number, string>();
  const pushEvent = (stepIndex: number, event: DraftEvent, primary: boolean) => {
    events.push(event);
    if (primary) primaryEventId.set(stepIndex, event.event_id);
  };

  approaches.forEach((approach, index) => {
    const stepIndex = steps.findIndex((step) => step.phrase === approach.phrase && step.action.kind === "approach");
    const start = translationOf(input.sceneStates, approach.actor) ?? [0, 0, 0];
    const end = approach.toward ? rootToward(input.sceneStates, approach.actor, approach.toward) : start;
    pushEvent(stepIndex, {
      event_id: `evt_approach_${index + 1}`,
      actor_id: approach.actor,
      action_type: "approach",
      start_frame: approach.span.start,
      end_frame: approach.span.end,
      text_condition: approach.phrase,
      trajectory_condition: trajectory(approach.span.start, approach.span.end, start, end),
    }, true);
  });

  handshakes.forEach((handshake, index) => {
    const stepIndex = steps.findIndex((step) => step.phrase === handshake.phrase && step.action.kind === "handshake");
    const contactId = `handshake_${String(index + 1).padStart(2, "0")}`;
    const leftId = `evt_handshake_${index + 1}_a`;
    const rightId = `evt_handshake_${index + 1}_b`;
    const start = handPoint(input.sceneStates, handshake.right);
    const end = midpoint(handPoint(input.sceneStates, handshake.left), handPoint(input.sceneStates, handshake.right));
    pushEvent(stepIndex, {
      event_id: leftId,
      actor_id: handshake.left,
      action_type: "handshake",
      start_frame: handshake.span.start,
      end_frame: handshake.span.end,
      text_condition: handshake.phrase,
      contact_ids: [contactId],
      primaryOf: stepIndex,
    }, true);
    events.push({
      event_id: rightId,
      actor_id: handshake.right,
      action_type: "handshake",
      start_frame: handshake.span.start,
      end_frame: handshake.span.end,
      text_condition: handshake.phrase,
      relation: { type: "while", ref_event_id: leftId, offset_frames: framesOf(input.clock, 0) },
      trajectory_condition: trajectory(handshake.span.start, handshake.span.end, start, end),
      contact_ids: [contactId],
    });
  });

  places.forEach((place, index) => {
    const stepIndex = steps.findIndex((step) => step.phrase === place.phrase && step.action.kind === "place");
    const start = handPoint(input.sceneStates, place.actor);
    const end = translationOf(input.sceneStates, place.surfaceId ?? place.objectId) ?? start;
    pushEvent(stepIndex, {
      event_id: `evt_place_${index + 1}`,
      actor_id: place.actor,
      action_type: "place",
      start_frame: place.span.start,
      end_frame: place.span.end,
      text_condition: place.phrase,
      trajectory_condition: trajectory(place.span.start, place.span.end, start, end),
      contact_ids: [`place_${String(index + 1).padStart(2, "0")}`],
    }, true);
  });

  for (const event of events) {
    const stepIndex = steps.findIndex((step) => step.phrase === event.text_condition);
    const span = spans[stepIndex];
    if (!span?.relation || event.relation) continue;
    if (event.primaryOf === undefined && !primaryEventId.has(stepIndex)) continue;
    const refId = primaryEventId.get(span.relation.refStep);
    if (!refId || event.event_id !== primaryEventId.get(stepIndex)) continue;
    event.relation = { type: span.relation.type, ref_event_id: refId, offset_frames: span.relation.offsetFrames };
  }

  const contacts = [
    ...handshakes.map((handshake, index) => {
      const hold = handshake.span.start + Math.floor((handshake.span.end - handshake.span.start) / 2);
      return {
        contact_id: `handshake_${String(index + 1).padStart(2, "0")}`,
        a: { actor_id: handshake.left, part: handshake.part },
        b: { actor_id: handshake.right, part: handshake.part },
        start_frame: hold,
        end_frame: handshake.span.end,
        type: "grasp" as const,
      };
    }),
    ...places.map((place, index) => ({
      contact_id: `place_${String(index + 1).padStart(2, "0")}`,
      a: { actor_id: place.actor, part: place.part },
      b: { object_id: place.objectId },
      start_frame: place.span.end,
      end_frame: place.span.end,
      type: "place" as const,
    })),
  ];

  const endFrame = Math.max(
    0,
    input.durationFrames ?? 0,
    ...events.map((event) => event.end_frame),
    ...contacts.map((contact) => contact.end_frame),
  );
  const preserve: EditSelector[] = [
    { kind: "camera_track" },
    { kind: "set_layout" },
    { kind: "background" },
  ];
  const recompute: EditSelector[] = [
    ...actorIds.map((actorId): EditSelector => ({ kind: "motion", actor_id: actorId })),
    ...actorIds.map((actorId): EditSelector => ({ kind: "contact_constraints", actor_id: actorId })),
    ...contacts.map((contact): EditSelector => ({ kind: "contact", contact_id: contact.contact_id })),
  ];

  return ActionGraphSchema.parse({
    schema_version: "0.1",
    graph_version: "1",
    shot_id: input.shotId,
    fps: input.clock.fps,
    frame_range: { start_frame: 0, end_frame: endFrame },
    status: "ready",
    clarifications: [],
    actors: actorIds.map((actorId) => ({ actor_id: actorId, rig: "smplx" as const })),
    utterances: [],
    events: events.map(({ primaryOf: _primaryOf, ...event }) => event),
    contact_graph: contacts,
    edit: {
      edit_id: "edit_1",
      base_graph_version: "0",
      operation: "insert_action",
      source: { type: input.source ?? "text", transcript },
      preserve,
      recompute,
    },
  });
};

const rootToward = (scenes: Record<string, SceneState> | undefined, fromId: string, toId: string): Vec3 => {
  const from = translationOf(scenes, fromId) ?? [0, 0, 0];
  const to = translationOf(scenes, toId) ?? from;
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return from;
  const distance = Math.min(0.5, length);
  return [from[0] + (dx / length) * distance, from[1], from[2] + (dz / length) * distance];
};
