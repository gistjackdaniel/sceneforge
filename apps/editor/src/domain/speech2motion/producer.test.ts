import { describe, expect, it } from "vitest";
import { emptyCommandBusState, undoCommand } from "../../application/commands/bus";
import { commitSpeech2Motion, planSpeech2Motion, speech2MotionFps } from "../../application/voice/speech2motion";
import { toFrame } from "../../application/voice/toFrame";
import { parseShot } from "../../domain/shot";
import type { Project } from "../../domain/project/types";
import { migrateWorldToSceneState } from "../../domain/worlds/migrateInstances";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import type { SceneState } from "../../domain/worlds/sceneState";
import type { WorldAsset } from "../../domain/worlds/types";
import { ActionGraphSchema, ActionGraphValidator, type ActionGraph, type EditSelector } from "./actionGraph";
import { parseDirection } from "./parseDirection";
import { STANDING_HAND_HEIGHT_M } from "./produce";

const shotTime = (fps: number, durationFrames = 96) =>
  ({ time: { fps, durationFrames, origin: "clip_local" as const } });

const move = (scene: SceneState, id: string, translation: [number, number, number]): SceneState => {
  const actor = scene.actors[id];
  if (actor) {
    return { ...scene, actors: { ...scene.actors, [id]: { ...actor, restTransform: { ...actor.restTransform, translation } } } };
  }
  const object = scene.objects[id];
  if (!object) throw new Error(`missing ${id}`);
  return { ...scene, objects: { ...scene.objects, [id]: { ...object, restTransform: { ...object.restTransform, translation } } } };
};

const stage = (props: string[]) => {
  const world: WorldAsset = normalizeWorldAsset({
    id: "world-stage",
    name: "Stage",
    coordinateSystem: "Y_UP",
    unitScaleMeters: 1,
    elements: [
      { id: "elem-a", name: "A", kind: "actor_mark", description: "" },
      { id: "elem-b", name: "B", kind: "actor_mark", description: "" },
    ],
    props,
  });
  let scene = migrateWorldToSceneState(world);
  const actorA = Object.values(scene.actors).find((actor) => actor.label === "A");
  const actorB = Object.values(scene.actors).find((actor) => actor.label === "B");
  if (!actorA || !actorB) throw new Error("actors missing");
  scene = move(scene, actorA.id, [0, 0, 0]);
  scene = move(scene, actorB.id, [1, 0, 0]);
  const cups = Object.values(scene.objects).filter((object) => object.label === "컵");
  const table = Object.values(scene.objects).find((object) => object.label === "테이블");
  cups.forEach((cup, index) => {
    scene = move(scene, cup.id, [0.2 + index, 0.75, 0.4]);
  });
  if (table) scene = move(scene, table.id, [0.2, 0.75, 0.4]);
  return { world, scene, actorA, actorB, cups, table };
};

const produce = (
  text: string,
  built: ReturnType<typeof stage>,
  options?: { fps?: number; sequenceFps?: number; baseGraph?: ActionGraph; shotId?: string },
) => {
  const fps = options?.fps;
  return planSpeech2Motion({
    text,
    locale: "ko",
    shotId: options?.shotId ?? "shot-stage",
    worlds: { [built.world.id]: built.world },
    sceneStates: { [built.world.id]: built.scene },
    ...(fps ? { shot: shotTime(fps) } : {}),
    ...(options?.sequenceFps ? { sequence: { fps: options.sequenceFps } } : {}),
    ...(options?.baseGraph ? { baseGraph: options.baseGraph } : {}),
  });
};

const selectorKey = (selector: EditSelector): string =>
  selector.kind === "contact" ? `contact:${selector.contact_id}` : `${selector.kind}:${"actor_id" in selector ? selector.actor_id ?? "" : ""}`;

const expectReady = (graph: ActionGraph): void => {
  expect(ActionGraphSchema.parse(graph)).toMatchObject({ schema_version: "0.1", status: "ready" });
  const result = ActionGraphValidator.parseReady(graph);
  expect(result.ok).toBe(true);
};

const projectFor = (shotId: string): Project => {
  const shot = parseShot({
    schemaVersion: 1,
    id: shotId,
    name: "Stage",
    time: { fps: 24, durationFrames: 96, origin: "clip_local" },
    subjects: [],
    camera: { status: "empty", lens: { focalLengthMm: 35 }, interpolation: "linear" },
    renders: [],
  });
  const now = "2026-11-12T00:00:00.000Z";
  return {
    id: "p",
    name: "P",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "Main", clipIds: [shotId], playhead: 0, visibleRange: [0, 96], fps: 24 } },
    clips: {
      [shotId]: { id: shotId, name: shot.name, start: 0, end: 96, duration: 96, sourceType: "empty", clipGraphId: "g", cacheStatus: "valid" },
    },
    clipGraphs: { g: { id: "g", clipId: shotId, rootNodeId: "n", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes: {},
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    shots: { [shotId]: shot },
  };
};

describe("speech direction parser", () => {
  it("reads handshake, place, and temporal links", () => {
    expect(parseDirection("A와 B가 오른손으로 악수")).toMatchObject({
      type: "sequence",
      steps: [{ action: { kind: "handshake", actors: ["A", "B"], hand: { count: 1, rigPart: "right_hand" } } }],
    });
    expect(parseDirection("A가 그 컵을 테이블에 내려놓는다")).toMatchObject({
      type: "sequence",
      steps: [{ action: { kind: "place", actor: "A", object: "그 컵", surface: "테이블", hand: { count: 0 } } }],
    });
    expect(parseDirection("B 접촉 손만 수정")).toMatchObject({ type: "edit_contact_hand", actor: "B", hand: { count: 0 } });
    expect(parseDirection("A가 다가간 다음 0.5초 후에 B와 오른손으로 악수")).toMatchObject({
      type: "sequence",
      steps: [
        { action: { kind: "approach", actor: "A" } },
        { action: { kind: "handshake", actors: ["B"] }, relation: { type: "after", offsetSeconds: 0.5 } },
      ],
    });
    const during = parseDirection("A가 다가가면서 B와 오른손으로 악수");
    expect(during.type).toBe("sequence");
    if (during.type === "sequence") expect(during.steps[1]?.relation?.type).toBe("while");
    expect(parseDirection("B와 오른손으로 악수하기 1초 전에 A가 다가간다")).toMatchObject({
      steps: [
        { action: { kind: "handshake" } },
        { action: { kind: "approach", actor: "A" }, relation: { type: "before", offsetSeconds: 1 } },
      ],
    });
  });
});

describe("speech2motion producer", () => {
  it("turns a right-hand handshake into a ready action graph", () => {
    const built = stage(["테이블"]);
    const { graph } = produce("A와 B가 오른손으로 악수", built, { fps: 24 });
    expectReady(graph);
    expect(graph.actors.map((actor) => actor.actor_id)).toEqual([built.actorA.id, built.actorB.id]);
    expect(graph.actors.every((actor) => actor.rig === "smplx")).toBe(true);
    expect(graph.fps).toBe(24);
    expect(graph.contact_graph).toEqual([
      expect.objectContaining({
        contact_id: "handshake_01",
        type: "grasp",
        a: { actor_id: built.actorA.id, part: "right_hand" },
        b: { actor_id: built.actorB.id, part: "right_hand" },
      }),
    ]);
    const partner = graph.events.find((event) => event.actor_id === built.actorB.id);
    expect(partner?.text_condition).toContain("악수");
    expect(partner?.relation).toEqual({ type: "while", ref_event_id: "evt_handshake_1_a", offset_frames: toFrame(0, 24) });
    expect(partner?.trajectory_condition?.space).toBe("world");
    const start = partner?.trajectory_condition?.points[0]?.position;
    const end = partner?.trajectory_condition?.points[1]?.position;
    expect(start?.[1]).toBeCloseTo(STANDING_HAND_HEIGHT_M);
    expect(end).toEqual([0.5, STANDING_HAND_HEIGHT_M, 0]);
    expect(start?.[2]).toBe(0);
    expect(graph.edit?.preserve.some((selector) => selectorKey(selector) === selectorKey({ kind: "motion", actor_id: built.actorB.id }))).toBe(false);
    expect(graph.edit?.recompute).toEqual(expect.arrayContaining([{ kind: "contact", contact_id: "handshake_01" }]));
  });

  it("places the cup on the table in world meters, Y-up", () => {
    const built = stage(["컵", "테이블"]);
    const cup = built.cups[0];
    if (!cup || !built.table) throw new Error("prop missing");
    const { graph } = produce("A가 그 컵을 테이블에 내려놓는다", built, { fps: 24 });
    expectReady(graph);
    expect(graph.contact_graph).toEqual([
      expect.objectContaining({
        type: "place",
        a: { actor_id: built.actorA.id, part: "right_hand" },
        b: { object_id: cup.id },
      }),
    ]);
    expect(graph.contact_graph[0]?.b.actor_id).toBeUndefined();
    const place = graph.events.find((event) => event.action_type === "place");
    expect(place?.text_condition).toContain("컵");
    expect(place?.trajectory_condition).toMatchObject({
      space: "world",
      points: [
        { position: [0, STANDING_HAND_HEIGHT_M, 0] },
        { position: [0.2, 0.75, 0.4] },
      ],
    });
    expect(place?.trajectory_condition?.points.every((point) => Number.isInteger(point.frame))).toBe(true);
  });

  it("edits only B's contact hand and keeps A's motion", () => {
    const built = stage(["테이블"]);
    const base = produce("A와 B가 오른손으로 악수", built, { fps: 24 }).graph;
    const { graph } = produce("B 접촉 손만 수정", built, { fps: 24, baseGraph: base });
    expectReady(graph);
    expect(base.graph_version).toBe("1");
    expect(graph.graph_version).toBe("2");
    expect(graph.events).toEqual(base.events);
    expect(graph.contact_graph).toEqual(base.contact_graph);
    const preserve = graph.edit?.preserve ?? [];
    const recompute = graph.edit?.recompute ?? [];
    expect(preserve).toEqual(expect.arrayContaining([{ kind: "motion", actor_id: built.actorA.id }]));
    expect(preserve).toEqual(expect.arrayContaining([{ kind: "root_motion", actor_id: built.actorA.id }]));
    expect(preserve).toEqual(expect.arrayContaining([{ kind: "root_motion", actor_id: built.actorB.id }]));
    expect(recompute).toEqual([
      { kind: "motion", actor_id: built.actorB.id },
      { kind: "contact_constraints", actor_id: built.actorB.id },
      { kind: "contact", contact_id: "handshake_01" },
    ]);
    const preserved = new Set(preserve.map(selectorKey));
    expect(recompute.every((selector) => !preserved.has(selectorKey(selector)))).toBe(true);
    expect(recompute.every((selector) => selector.kind === "contact" || ("actor_id" in selector && selector.actor_id === built.actorB.id))).toBe(true);
    expect(graph.events.some((event) => event.actor_id === built.actorA.id)).toBe(true);
    expect(graph.contact_graph[0]?.a.part).toBe("right_hand");
    expect(graph.contact_graph[0]?.b.part).toBe("right_hand");
  });

  it("asks which cup when 그 컵 matches two cups", () => {
    const built = stage(["컵", "컵", "테이블"]);
    expect(built.cups).toHaveLength(2);
    const { graph, commands } = produce("A가 그 컵을 테이블에 내려놓는다", built, { fps: 24 });
    expect(graph.status).toBe("needs_clarification");
    expect(graph.clarifications.length).toBeGreaterThan(0);
    expect(graph.clarifications.some((item) => item.question.includes("어느"))).toBe(true);
    expect(graph.contact_graph).toEqual([]);
    expect(graph.actors).toEqual([]);
    expect(ActionGraphSchema.safeParse(graph).success).toBe(true);
    const ready = ActionGraphValidator.parseReady(graph);
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.errors).toEqual([expect.objectContaining({ code: "needs_clarification", path: ["status"] })]);
    expect(commands).toEqual([]);
  });

  it("converts before, after, and while offsets with toFrame and the shot fps chain", () => {
    const built = stage(["테이블"]);
    const after = produce("A가 다가간 다음 0.5초 후에 B와 오른손으로 악수", built, { fps: 24 }).graph;
    expectReady(after);
    const afterEvent = after.events.find((event) => event.relation?.type === "after");
    expect(afterEvent?.relation?.offset_frames).toBe(toFrame(0.5, 24));
    expect(afterEvent?.start_frame).toBe(toFrame(2, 24) + toFrame(0.5, 24));
    expect(Number.isInteger(afterEvent?.relation?.offset_frames)).toBe(true);

    const faster = produce("A가 다가간 다음 0.5초 후에 B와 오른손으로 악수", built, { fps: 30, sequenceFps: 12 }).graph;
    expect(faster.fps).toBe(30);
    expect(faster.events.find((event) => event.relation?.type === "after")?.relation?.offset_frames).toBe(toFrame(0.5, 30));

    const fromSequence = produce("A가 다가간 다음 0.5초 후에 B와 오른손으로 악수", built, { sequenceFps: 12 }).graph;
    expect(fromSequence.fps).toBe(12);
    expect(fromSequence.events.find((event) => event.relation?.type === "after")?.relation?.offset_frames).toBe(toFrame(0.5, 12));

    const fallback = produce("A가 다가간 다음 0.5초 후에 B와 오른손으로 악수", built).graph;
    expect(fallback.fps).toBe(speech2MotionFps(undefined, undefined));
    expect(fallback.events.find((event) => event.relation?.type === "after")?.relation?.offset_frames).toBe(toFrame(0.5, 24));

    const during = produce("A가 다가가면서 B와 오른손으로 악수", built, { fps: 24 }).graph;
    expectReady(during);
    expect(during.events.some((event) => event.relation?.type === "while" && event.relation.offset_frames === toFrame(0, 24))).toBe(true);

    const before = produce("B와 오른손으로 악수하기 1초 전에 A가 다가간다", built, { fps: 24 }).graph;
    expectReady(before);
    const earlier = before.events.find((event) => event.relation?.type === "before");
    expect(earlier?.relation?.offset_frames).toBe(-toFrame(1, 24));
    expect(earlier?.action_type).toBe("approach");
  });

  it("records a ready graph only through the domain command bus", () => {
    const built = stage(["테이블"]);
    const shotId = "shot-stage";
    const { graph, commands } = produce("A와 B가 오른손으로 악수", built, { fps: 24, shotId });
    expect(commands).toEqual([{ type: "RECORD_SPEECH2MOTION", shotId, graph }]);
    const project = projectFor(shotId);
    const committed = commitSpeech2Motion(project, emptyCommandBusState(), graph, "2026-11-12T00:00:00.000Z");
    expect(project.speech2motion).toBeUndefined();
    expect(committed.result.ok).toBe(true);
    expect(committed.project.speech2motion?.[shotId]).toEqual(graph);
    const undone = undoCommand(committed.project, committed.bus, "2026-11-12T00:00:01.000Z");
    expect(undone.project.speech2motion).toBeUndefined();

    const ambiguous = produce("A가 그 컵을 테이블에 내려놓는다", stage(["컵", "컵", "테이블"]), { fps: 24, shotId });
    const skipped = commitSpeech2Motion(project, emptyCommandBusState(), ambiguous.graph, "2026-11-12T00:00:00.000Z");
    expect(skipped.result.ok).toBe(false);
    expect(skipped.project.speech2motion).toBeUndefined();
  });

  it("does not transcribe audio", () => {
    const built = stage(["테이블"]);
    const { graph } = planSpeech2Motion({
      audio: new Uint8Array([1, 2, 3]),
      shotId: "shot-stage",
      locale: "ko",
      worlds: { [built.world.id]: built.world },
      sceneStates: { [built.world.id]: built.scene },
      shot: shotTime(24),
    });
    expect(graph.status).toBe("needs_clarification");
    expect(graph.clarifications[0]?.question).toContain("텍스트");
  });
});
