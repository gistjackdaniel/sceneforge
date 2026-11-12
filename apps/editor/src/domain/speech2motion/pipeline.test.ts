import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, undoCommand } from "../../application/commands/bus";
import type { DomainCommand } from "../../application/commands/types";
import type { Project } from "../../domain/project/types";
import { parseShot, selectedTake, type Shot, type ShotCommand } from "../shot";
import { normalizeWorldAsset } from "../worlds/normalize";
import { createWorldTargetResolver, type TargetResolver } from "../worlds/query";
import type { ActorPoseSequence } from "./motionModel";
import { hashNormalized } from "./normalizedHash";
import { GENERATED_MOTION_SOURCE, translationOf } from "./objectStream";
import { jointIndex, SmplxSkeleton, Vec, type Vec3 } from "./pose";
import { PreserveVerifier } from "./preserveVerifier";
import { Speech2MotionPipeline } from "./pipeline";

const now = "2026-11-12T00:00:00.000Z";
const SHOT_ID = "shot-handshake-cup";
const SHOT_FPS = 16;
const FRAME_COUNT = 128;
const ACTOR_A = "inst_fixture_actor_a";
const ACTOR_B = "inst_fixture_actor_b";
const CUP = "inst_fixture_cup";
const TABLE = "inst_fixture_table";
const WORLD = "world-handshake-set";
const CAMERA_A = "cam_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CAMERA_B = "cam_01ARZ3NDEKTSV4RRFFQ69G5FBW";
const TABLE_POSITION = [-0.45, 1.25, 0.3] as [number, number, number];

const transform = (position: [number, number, number]) => ({
  position,
  rotationEuler: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

const human = (id: string, name: string) => ({
  id,
  assetId: "asset-human",
  assetVersion: 1,
  name,
  uri: "mesh/human.glb",
  placement: transform([0, 0, 0]),
  visible: true,
  locked: false,
  kind: "human" as const,
  representation: "mesh" as const,
  motion: { channel: "unset" as const },
});

const prop = (id: string, name: string, position: [number, number, number]) => ({
  id,
  assetId: `asset-${id}`,
  assetVersion: 1,
  name,
  uri: `mesh/${id}.glb`,
  placement: transform(position),
  visible: true,
  locked: false,
  kind: "object" as const,
  representation: "mesh" as const,
  motion: { channel: "unset" as const },
});

const light = {
  id: "light-1",
  assetId: "primitive:light",
  assetVersion: 1,
  name: "Key",
  uri: "primitive:light",
  placement: transform([0, 2.5, 0]),
  visible: true,
  locked: false,
  kind: "light" as const,
  representation: "light" as const,
  intensity: 2,
  color: "#fff4e0",
};

const camera = (takeId: string) => ({
  status: "ready" as const,
  lens: { focalLengthMm: 35 },
  interpolation: "linear" as const,
  selectedTakeId: takeId,
  takes: [
    {
      schemaVersion: 1 as const,
      id: takeId,
      name: "Take",
      source: "manual" as const,
      keys: [{ frame: 0, position: [0, 1.6, 4] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], focalLengthMm: 35 }],
      createdAt: now,
    },
  ],
});

const shotOf = (takeId: string): Shot =>
  parseShot({
    schemaVersion: 1,
    id: SHOT_ID,
    name: SHOT_ID,
    time: { fps: SHOT_FPS, durationFrames: FRAME_COUNT, origin: "clip_local" },
    subjects: [
      human(ACTOR_A, "A"),
      human(ACTOR_B, "B"),
      prop(CUP, CUP, [0.2, 1.2, 0.1]),
      prop(TABLE, "table", TABLE_POSITION),
      light,
    ],
    camera: camera(takeId),
    environment: { worldId: WORLD },
    renders: [],
  });

const projectOf = (shot: Shot): Project => ({
  id: "p",
  name: "P",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq",
  sequences: { seq: { id: "seq", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, shot.time.durationFrames] } },
  clips: {
    [shot.id]: {
      id: shot.id,
      name: shot.name,
      start: 0,
      end: shot.time.durationFrames,
      duration: shot.time.durationFrames,
      sourceType: "empty",
      clipGraphId: "g",
      cacheStatus: "valid",
    },
  },
  clipGraphs: { g: { id: "g", clipId: shot.id, rootNodeId: "n", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
  shots: { [shot.id]: shot },
});

const busCommand = (commands: readonly ShotCommand[]): DomainCommand => ({
  type: "APPLY_COMMANDS",
  commands: commands.map((command) => ({ type: "SHOT", command })),
  logMessage: "speech2motion",
});

const emptyResolver: TargetResolver = { resolve: () => [] };

const room = () =>
  createWorldTargetResolver({
    [WORLD]: normalizeWorldAsset({
      id: WORLD,
      name: "Handshake set",
      props: [CUP, "table"],
      aliases: [CUP, TABLE, "table"],
    }),
  });

const handshakeGraph = (part: "right_hand" | "left_hand", fps = SHOT_FPS) => ({
  schema_version: "0.1" as const,
  graph_version: "1",
  shot_id: SHOT_ID,
  fps,
  frame_range: { start_frame: 0, end_frame: FRAME_COUNT - 1 },
  status: "ready" as const,
  clarifications: [],
  actors: [
    { actor_id: ACTOR_A, rig: "smplx" as const },
    { actor_id: ACTOR_B, rig: "smplx" as const },
  ],
  utterances: [],
  events: [
    { event_id: "evt_a", actor_id: ACTOR_A, action_type: "stand", start_frame: 0, end_frame: FRAME_COUNT - 1, text_condition: "선다" },
    { event_id: "evt_b", actor_id: ACTOR_B, action_type: "handshake", start_frame: 72, end_frame: 111, text_condition: "악수" },
    { event_id: "evt_cup", actor_id: ACTOR_A, action_type: "place", start_frame: 0, end_frame: FRAME_COUNT - 1, text_condition: "컵을 내려놓는다" },
  ],
  contact_graph: [
    {
      contact_id: "handshake_01",
      a: { actor_id: ACTOR_A, part: "right_hand" as const },
      b: { actor_id: ACTOR_B, part },
      start_frame: 72,
      end_frame: 111,
      type: "grasp" as const,
    },
    {
      contact_id: "cup_hold_01",
      a: { actor_id: ACTOR_A, part: "left_hand" as const },
      b: { object_id: CUP },
      start_frame: 0,
      end_frame: 47,
      type: "grasp" as const,
    },
    {
      contact_id: "cup_place_01",
      a: { actor_id: ACTOR_A, part: "left_hand" as const },
      b: { object_id: CUP },
      start_frame: 32,
      end_frame: FRAME_COUNT - 1,
      type: "place" as const,
    },
  ],
  edit: {
    edit_id: "edit_handshake",
    base_graph_version: "0",
    operation: "change_contact_effector",
    source: { type: "text" as const, transcript: part === "right_hand" ? "B를 오른손 악수로" : "B를 왼손 악수로" },
    preserve: [
      { kind: "camera_track" as const },
      { kind: "motion" as const, actor_id: ACTOR_A },
      { kind: "root_motion" as const, actor_id: ACTOR_A },
      { kind: "set_layout" as const },
      { kind: "background" as const },
      { kind: "contact" as const, contact_id: "cup_hold_01" },
      { kind: "contact" as const, contact_id: "cup_place_01" },
    ],
    recompute: [
      { kind: "motion" as const, actor_id: ACTOR_B },
      { kind: "contact" as const, contact_id: "handshake_01" },
    ],
  },
});

const wristAt = (actors: readonly ActorPoseSequence[], actorId: string, frame: number, name: "right_wrist" | "left_wrist"): Vec3 | undefined => {
  const sequence = actors.find((actor) => actor.actorId === actorId);
  return sequence?.frames.find((item) => item.frame === frame)?.joints[jointIndex(name)]?.translation;
};

describe("speech2motion pipeline", () => {
  it("keeps camera, background, A's motion, and the cup when B's contact hand switches", () => {
    const shot = shotOf(CAMERA_A);
    const right = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot, targetResolver: room() });
    const left = Speech2MotionPipeline.run({ graph: handshakeGraph("left_hand"), shot, targetResolver: room() });
    expect(right.ok).toBe(true);
    expect(left.ok).toBe(true);
    if (!right.ok || !left.ok) return;

    expect(right.scene.fps).toBe(SHOT_FPS);
    expect(right.scene.frameCount).toBe(FRAME_COUNT);
    expect(right.scene.actors.every((actor) => actor.source === GENERATED_MOTION_SOURCE)).toBe(true);
    expect((right.scene.camera as { cameraTrackId: string }).cameraTrackId).toBe(selectedTake(shot)?.id);
    expect(selectedTake(shot)?.id).toBe(CAMERA_A);

    const preserved = PreserveVerifier.verify(right.scene, left.scene, handshakeGraph("right_hand").edit.preserve);
    expect(preserved.ok).toBe(true);
    const motionB = { kind: "motion" as const, actor_id: ACTOR_B };
    const contact = { kind: "contact" as const, contact_id: "handshake_01" };
    expect(hashNormalized(PreserveVerifier.project(right.scene, motionB))).not.toBe(
      hashNormalized(PreserveVerifier.project(left.scene, motionB)),
    );
    expect(hashNormalized(PreserveVerifier.project(right.scene, contact))).not.toBe(
      hashNormalized(PreserveVerifier.project(left.scene, contact)),
    );
    expect(hashNormalized(right.scene.objects)).toBe(hashNormalized(left.scene.objects));
    expect(hashNormalized(right.scene.attachments)).toBe(hashNormalized(left.scene.attachments));

    const otherCamera = shotOf(CAMERA_B);
    const moved = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot: otherCamera, targetResolver: room() });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect((moved.scene.camera as { cameraTrackId: string }).cameraTrackId).toBe(CAMERA_B);
    const cameraSelector = { kind: "camera_track" as const };
    expect(hashNormalized(PreserveVerifier.project(right.scene, cameraSelector))).not.toBe(
      hashNormalized(PreserveVerifier.project(moved.scene, cameraSelector)),
    );

    const anchor = wristAt(right.scene.actors, ACTOR_A, 90, "right_wrist");
    expect(anchor).toBeDefined();
    if (!anchor) return;
    expect(Vec.length(Vec.sub(wristAt(right.scene.actors, ACTOR_B, 90, "right_wrist")!, anchor))).toBeLessThan(1e-3);
    expect(Vec.length(Vec.sub(wristAt(left.scene.actors, ACTOR_B, 90, "left_wrist")!, anchor))).toBeLessThan(1e-3);
    expect(right.scene.actors.find((actor) => actor.actorId === ACTOR_A)?.frames).toEqual(
      left.scene.actors.find((actor) => actor.actorId === ACTOR_A)?.frames,
    );

    const cup = right.scene.objects[0];
    expect(cup?.objectId).toBe(CUP);
    expect(cup?.source).toBe(GENERATED_MOTION_SOURCE);
    expect(cup?.frames).toHaveLength(FRAME_COUNT);
    expect(cup?.frames.map((frame) => frame.t)).toEqual(Array.from({ length: FRAME_COUNT }, (_, frame) => frame));
    const held = translationOf(cup!.frames[0]!.T_world_obj);
    const leftWrist = wristAt(right.scene.actors, ACTOR_A, 0, "left_wrist")!;
    expect(held[0]).toBeCloseTo(leftWrist[0], 4);
    const placed = translationOf(cup!.frames[48]!.T_world_obj);
    const last = translationOf(cup!.frames[127]!.T_world_obj);
    expect(placed).toEqual(last);
    expect(placed[0]).toBeCloseTo(TABLE_POSITION[0], 5);
    expect(placed[1]).toBeCloseTo(TABLE_POSITION[1], 5);
    expect(placed[2]).toBeCloseTo(TABLE_POSITION[2], 5);
    expect(right.scene.attachments[0]).toMatchObject({
      parentId: ACTOR_A,
      rigPart: "left_hand",
      sourceContactId: "cup_hold_01",
      startFrame: 0,
      endFrame: 48,
    });
    expect(right.scene.attachments[1]).toEqual({
      objectId: CUP,
      parentId: TABLE,
      sourceContactId: "cup_place_01",
      startFrame: 48,
      endFrame: FRAME_COUNT,
    });
    expect(right.scene.actors[0]?.frames[90]?.joints[SmplxSkeleton.pelvisIndex]?.translation[1]).toBeCloseTo(0.95, 5);

    expect(right.commands.every((command) => command.type === "REPLACE_SUBJECT")).toBe(true);
    expect(right.commands.some((command) => command.type === "REPLACE_SUBJECT" && command.subject.id === CUP)).toBe(false);
    expect(right.commands.some((command) => command.type === "REPLACE_SUBJECT" && command.subject.id === TABLE)).toBe(false);
    expect(right.commands.some((command) => command.type === "REPLACE_SUBJECT" && command.subject.id === ACTOR_B)).toBe(true);

    let current = projectOf(shot);
    let bus = emptyCommandBusState();
    const applied = executeCommand(current, bus, busCommand(right.commands), now);
    expect(applied.result.ok).toBe(true);
    current = applied.project;
    bus = applied.bus;
    const afterRight = current.shots?.[SHOT_ID];
    expect(afterRight?.camera).toEqual(shot.camera);
    expect(afterRight?.subjects.find((subject) => subject.id === "light-1")).toEqual(shot.subjects.find((subject) => subject.id === "light-1"));
    const actorA = afterRight?.subjects.find((subject) => subject.id === ACTOR_A);
    expect(actorA && actorA.kind !== "light" && actorA.motion.channel).toBe("explicit");
    const cupSubject = afterRight?.subjects.find((subject) => subject.id === CUP);
    expect(cupSubject && cupSubject.kind !== "light" && cupSubject.motion.channel).toBe("unset");

    const switched = executeCommand(current, bus, busCommand(left.commands), now);
    expect(switched.result.ok).toBe(true);
    const afterLeft = switched.project.shots?.[SHOT_ID];
    expect(afterLeft?.camera).toEqual(shot.camera);
    expect(afterLeft?.subjects.find((subject) => subject.id === "light-1")).toEqual(shot.subjects.find((subject) => subject.id === "light-1"));
    expect(afterLeft?.subjects.find((subject) => subject.id === CUP)).toEqual(afterRight?.subjects.find((subject) => subject.id === CUP));
    expect(JSON.stringify(afterLeft?.subjects.find((subject) => subject.id === ACTOR_A))).toBe(JSON.stringify(actorA));

    const undone = undoCommand(current, bus, now);
    expect(undone.result.ok).toBe(true);
    expect(undone.project.shots?.[SHOT_ID]?.camera).toEqual(shot.camera);
    expect(undone.project.shots?.[SHOT_ID]?.subjects.find((subject) => subject.id === ACTOR_B)).toEqual(
      shot.subjects.find((subject) => subject.id === ACTOR_B),
    );
  });

  it("leaves the cup alone when TargetResolver does not name it", () => {
    const shot = shotOf(CAMERA_A);
    const missed = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot, targetResolver: emptyResolver });
    expect(missed.ok).toBe(true);
    if (!missed.ok) return;
    expect(missed.scene.contacts.find((contact) => contact.contactId === "cup_hold_01")?.resolved).toBe(false);
    expect(missed.scene.objects).toEqual([]);
    expect(missed.commands.some((command) => command.type === "REPLACE_SUBJECT" && command.subject.id === CUP)).toBe(false);
    expect(wristAt(missed.scene.actors, ACTOR_A, 40, "left_wrist")).toEqual(wristAt(missed.scene.actors, ACTOR_A, 0, "left_wrist"));
  });

  it("rejects an action graph whose fps is not Shot.time.fps", () => {
    const shot = shotOf(CAMERA_A);
    const result = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand", 30), shot, targetResolver: room() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === "fps_mismatch")).toBe(true);
  });
});
