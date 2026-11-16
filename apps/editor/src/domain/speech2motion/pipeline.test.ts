import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, undoCommand } from "../../application/commands/bus";
import type { DomainCommand } from "../../application/commands/types";
import { attachSceneStates } from "../../domain/project/sceneLink";
import type { Project } from "../../domain/project/types";
import { parseShot, selectedTake, type Shot, type ShotCommand } from "../shot";
import { normalizeWorldAsset } from "../worlds/normalize";
import { createWorldTargetResolver, type TargetResolver } from "../worlds/query";
import { StubMotionModel, type ActorPoseSequence } from "./motionModel";
import { computePassHash } from "./normalizedHash";
import { MOTION_BAKE_TOLERANCE } from "../shot/motionBake";
import {
  PHASE0_ACTOR_A_ROOT,
  PHASE0_ACTOR_B_ROOT,
  PHASE0_CUP_IN_HAND_OFFSET,
  PHASE0_LEFT_SHOULDER_IN_ROOT,
  PHASE0_STUB_ARM_LENGTH_M,
  PHASE0_TABLE_POSITION,
  phase0LeftHandWorldPose,
} from "../shot/phase0Sample";
import { composeWorldPose, GENERATED_MOTION_SOURCE, translationOf } from "./objectStream";
import { jointIndex, SmplxSkeleton, Vec, type Vec3 } from "./pose";
import { PreserveVerifier } from "./preserveVerifier";
import { Speech2MotionPipeline } from "./pipeline";
import { ShotPoseAdapter } from "./shotPoseAdapter";

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
const transform = (position: [number, number, number]) => ({
  position,
  rotationEuler: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

const human = (id: string, name: string, position: [number, number, number]) => ({
  id,
  assetId: "asset-human",
  assetVersion: 1,
  name,
  uri: "mesh/human.glb",
  placement: transform(position),
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
      human(ACTOR_A, "A", [...PHASE0_ACTOR_A_ROOT]),
      human(ACTOR_B, "B", [...PHASE0_ACTOR_B_ROOT]),
      prop(CUP, CUP, [0.2, 1.2, 0.1]),
      prop(TABLE, "table", [...PHASE0_TABLE_POSITION]),
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

const emptyResolver: TargetResolver = {
  resolve: () => [],
  resolveMention: () => ({ status: "missing" }),
};

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

    const preserved = PreserveVerifier.verify(right.scene, left.scene, handshakeGraph("right_hand").edit);
    expect(preserved.ok).toBe(true);
    const motionB = { kind: "motion" as const, actor_id: ACTOR_B };
    const contact = { kind: "contact" as const, contact_id: "handshake_01" };
    expect(computePassHash(PreserveVerifier.project(right.scene, motionB))).not.toBe(
      computePassHash(PreserveVerifier.project(left.scene, motionB)),
    );
    expect(computePassHash(PreserveVerifier.project(right.scene, contact))).not.toBe(
      computePassHash(PreserveVerifier.project(left.scene, contact)),
    );
    expect(computePassHash(right.scene.objects)).toBe(computePassHash(left.scene.objects));
    expect(computePassHash(right.scene.attachments)).toBe(computePassHash(left.scene.attachments));

    const otherCamera = shotOf(CAMERA_B);
    const moved = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot: otherCamera, targetResolver: room() });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect((moved.scene.camera as { cameraTrackId: string }).cameraTrackId).toBe(CAMERA_B);
    const cameraSelector = { kind: "camera_track" as const };
    expect(computePassHash(PreserveVerifier.project(right.scene, cameraSelector))).not.toBe(
      computePassHash(PreserveVerifier.project(moved.scene, cameraSelector)),
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
    const handAtRelease = wristAt(right.scene.actors, ACTOR_A, 48, "left_wrist")!;
    const expectedHand = phase0LeftHandWorldPose(48).translation;
    expect(Vec.length(Vec.sub(handAtRelease, expectedHand))).toBeLessThanOrEqual(MOTION_BAKE_TOLERANCE.positionMeters);
    const shoulder = [
      PHASE0_ACTOR_A_ROOT[0] + PHASE0_LEFT_SHOULDER_IN_ROOT[0],
      PHASE0_ACTOR_A_ROOT[1] + PHASE0_LEFT_SHOULDER_IN_ROOT[1],
      PHASE0_ACTOR_A_ROOT[2] + PHASE0_LEFT_SHOULDER_IN_ROOT[2],
    ] as [number, number, number];
    const reach = Vec.length(Vec.sub(handAtRelease, shoulder));
    expect(reach).toBeLessThanOrEqual(PHASE0_STUB_ARM_LENGTH_M + 1e-9);
    expect(reach).toBeCloseTo(0.53, 2);
    const placed = translationOf(cup!.frames[48]!.T_world_obj);
    const last = translationOf(cup!.frames[127]!.T_world_obj);
    expect(placed).toEqual(last);
    expect(Math.abs(placed[1] - PHASE0_TABLE_POSITION[1])).toBeLessThanOrEqual(MOTION_BAKE_TOLERANCE.positionMeters);
    expect(Vec.length(Vec.sub(placed, PHASE0_TABLE_POSITION))).toBeLessThanOrEqual(MOTION_BAKE_TOLERANCE.positionMeters);
    const heldFrame = cup!.frames[47]!;
    const heldJoint = right.scene.actors
      .find((actor) => actor.actorId === ACTOR_A)
      ?.frames.find((frame) => frame.frame === 47)
      ?.joints[jointIndex("left_wrist")];
    expect(heldJoint).toBeDefined();
    if (!heldJoint) return;
    const composed = translationOf(composeWorldPose(heldJoint.translation, heldJoint.rotation, PHASE0_CUP_IN_HAND_OFFSET));
    expect(Vec.length(Vec.sub(composed, translationOf(heldFrame.T_world_obj)))).toBeLessThanOrEqual(MOTION_BAKE_TOLERANCE.positionMeters);
    expect(right.scene.attachments[0]).toMatchObject({
      parentId: ACTOR_A,
      rigPart: "left_hand",
      sourceContactId: "cup_hold_01",
      startFrame: 0,
      endFrame: 48,
      offset: { translation: PHASE0_CUP_IN_HAND_OFFSET },
    });
    expect(right.scene.attachments[1]).toEqual({
      objectId: CUP,
      parentId: TABLE,
      sourceContactId: "cup_place_01",
      startFrame: 48,
      endFrame: FRAME_COUNT,
      offset: { translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    });
    expect(right.scene.actors.find((actor) => actor.actorId === ACTOR_A)?.frames[90]?.joints[SmplxSkeleton.pelvisIndex]?.translation)
      .toEqual([...PHASE0_ACTOR_A_ROOT]);
    const scoped = { kind: "motion" as const, actor_id: ACTOR_A, instanceIds: [ACTOR_A] };
    const other = { kind: "motion" as const, actor_id: ACTOR_A, instanceIds: [ACTOR_B] };
    expect(computePassHash(PreserveVerifier.project(right.scene, scoped))).toBe(
      computePassHash(PreserveVerifier.project(right.scene, { kind: "motion", actor_id: ACTOR_A })),
    );
    expect(PreserveVerifier.project(right.scene, other)).toBeNull();

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
    if (actorA && actorA.kind !== "light" && actorA.motion.channel === "explicit") {
      expect(actorA.motion.body?.model).toBe("smplx");
      expect(actorA.motion.body?.frames).toHaveLength(FRAME_COUNT);
      expect(actorA.motion.body?.frames[0]?.pose.body_pose).toHaveLength(63);
      expect(actorA.motion.body?.frames[0]?.pose.left_hand_pose).toHaveLength(45);
      expect(actorA.motion.body?.frames[0]?.pose.right_hand_pose).toHaveLength(45);
      expect(actorA.motion.body?.frames[0]?.pose.expression).toHaveLength(10);
      expect(actorA.motion.body?.frames[0]?.pose.jaw_pose).toHaveLength(3);
      expect(actorA.uri).toBe("mesh/human.glb");
    }
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

  it("fails when Shot.time.fps is missing", () => {
    const shot = shotOf(CAMERA_A);
    const missing = { ...shot, time: { ...shot.time, fps: undefined } } as unknown as Shot;
    expect(() =>
      Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot: missing, targetResolver: room() }),
    ).toThrow("Shot time.fps is required.");
  });

  it("keeps a keyed pose when no generated provenance is supplied", () => {
    const shot = shotOf(CAMERA_A);
    const subject = shot.subjects.find((item) => item.id === ACTOR_A);
    expect(subject && subject.kind !== "light").toBe(true);
    if (!subject || subject.kind === "light") return;
    const keyed = ShotPoseAdapter.withKeys(subject, [{
      frame: 0,
      position: subject.placement.position,
      rotationEuler: subject.placement.rotationEuler,
      scale: subject.placement.scale,
    }]);
    expect(keyed && keyed.kind !== "light" && keyed.motion.channel === "explicit" && keyed.motion.provenance).toEqual({ kind: "keyed" });
    const stored = parseShot({ ...shot, subjects: shot.subjects.map((item) => item.id === ACTOR_A && keyed ? keyed : item) });
    const again = stored.subjects.find((item) => item.id === ACTOR_A);
    expect(again && again.kind !== "light" && again.motion.channel === "explicit" && again.motion.provenance).toEqual({ kind: "keyed" });
  });

  it("keeps generated pose provenance on the shot after scene state is attached", () => {
    const shot = parseShot({
      ...shotOf(CAMERA_A),
      subjects: shotOf(CAMERA_A).subjects.map((subject) =>
        subject.kind === "human"
          ? { ...subject, instanceId: subject.id, assetRef: { assetId: subject.assetId, revisionId: `${subject.assetId}-r1` } }
          : subject,
      ),
    });
    const model = new StubMotionModel();
    const result = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand"), shot, targetResolver: room(), model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = {
      kind: "generated" as const,
      source: GENERATED_MOTION_SOURCE,
      actionGraph: { shotId: SHOT_ID, graphVersion: "1" },
      model: { adapterId: model.adapterId, modelFps: model.modelFps },
    };
    const applied = executeCommand(projectOf(shot), emptyCommandBusState(), busCommand(result.commands), now);
    expect(applied.result.ok).toBe(true);
    const saved = applied.project.shots?.[SHOT_ID];
    expect(saved).toBeDefined();
    if (!saved) return;
    const roundTrip = parseShot(JSON.parse(JSON.stringify(saved)));
    const pose = roundTrip.subjects.find((subject) => subject.id === ACTOR_A);
    expect(pose && pose.kind !== "light" && pose.motion.channel === "explicit" && pose.motion.provenance).toEqual(expected);
    if (!pose || pose.kind === "light" || pose.motion.channel !== "explicit") return;
    expect(pose.motion.keys.every((key) => Number.isInteger(key.frame))).toBe(true);

    const linked = attachSceneStates({
      ...applied.project,
      shots: { ...applied.project.shots, [SHOT_ID]: roundTrip },
      worlds: {
        [WORLD]: normalizeWorldAsset({
          id: WORLD,
          name: "Handshake set",
          props: [CUP, "table"],
          aliases: [CUP, TABLE, "table"],
        }),
      },
    });
    expect(linked.sceneStates?.[WORLD]?.actors[ACTOR_A]?.id).toBe(ACTOR_A);
    expect(linked.sceneStates?.[WORLD]?.actors[ACTOR_B]?.id).toBe(ACTOR_B);
    const kept = linked.shots?.[SHOT_ID]?.subjects.find((subject) => subject.id === ACTOR_A);
    expect(kept && kept.kind !== "light" && kept.motion.channel === "explicit" && kept.motion.provenance).toEqual(expected);
  });

  it("rejects an action graph whose fps is not Shot.time.fps", () => {
    const shot = shotOf(CAMERA_A);
    const result = Speech2MotionPipeline.run({ graph: handshakeGraph("right_hand", 30), shot, targetResolver: room() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === "fps_mismatch")).toBe(true);
  });
});
