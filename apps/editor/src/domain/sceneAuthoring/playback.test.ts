import { describe, expect, it } from "vitest";
import { parseShot } from "../shot/schema";
import {
  ACTOR_A_ROOT,
  ACTOR_B_ROOT,
  CUP_IN_HAND_OFFSET,
  CUP_PLACE_FRAME,
  FIXTURE_DURATION_FRAMES,
  FIXTURE_FPS,
  GENERATED_POSE_SOURCE,
  HANDSHAKE_CONTACT_GRAPH,
  HANDSHAKE_RANGE,
  HANDSHAKE_WORLD_IDS,
  SUBJECT_IDS,
  TABLE_POSITION,
  createHandshakePoseSource,
  createHandshakePreviewRecord,
  createHandshakeShot,
  frameAtTime,
  interactionPreviewSchema,
  readContact,
  resolveContacts,
  samplePlayback,
} from "./index";
import { quatRotate, translationOf } from "./math";
import type { PoseSequenceSource } from "./poseSource";

const nearly = (value: readonly number[], expected: readonly number[]) => {
  expected.forEach((item, index) => expect(value[index]).toBeCloseTo(item, 5));
};

describe("handshake pose fixture", () => {
  const shot = createHandshakeShot();
  const preview = createHandshakePreviewRecord();
  const poses = createHandshakePoseSource(shot, resolveContacts(preview));

  it("pelvis는 shot pose이고 회전은 rotationEuler XYZ다", () => {
    const pose = poses.actorPose(SUBJECT_IDS.actorA, 0);
    expect(pose?.source).toBe(GENERATED_POSE_SOURCE);
    expect(pose?.position).toEqual([...ACTOR_A_ROOT]);
    expect(pose?.rotationEuler).toEqual([0, 0, 0]);
    const played = samplePlayback(shot, preview, 0, poses);
    expect(played.actors.find((actor) => actor.subjectId === SUBJECT_IDS.actorA)?.root.eulerOrder).toBe("XYZ");
    expect(played.fps).toBe(shot.time.fps);
    expect(played.timeSeconds).toBe(0);
    expect(frameAtTime(1, shot)).toBe(FIXTURE_FPS);
  });

  it("루트와 테이블은 확정된 월드 좌표다", () => {
    const actorA = shot.subjects.find((subject) => subject.id === SUBJECT_IDS.actorA);
    const actorB = shot.subjects.find((subject) => subject.id === SUBJECT_IDS.actorB);
    const table = shot.subjects.find((subject) => subject.id === SUBJECT_IDS.table);
    expect(actorA && actorA.kind !== "light" && actorA.placement.position).toEqual([...ACTOR_A_ROOT]);
    expect(actorB && actorB.kind !== "light" && actorB.placement.position).toEqual([...ACTOR_B_ROOT]);
    expect(table && table.kind !== "light" && table.placement.position).toEqual([...TABLE_POSITION]);
    expect(ACTOR_A_ROOT).toEqual([1.001, 0.38, -0.309]);
    expect(ACTOR_B_ROOT).toEqual([2.001, 0.38, -0.309]);
    expect(TABLE_POSITION).toEqual([1.25, 0.72, 0.1]);
  });

  it("컵은 128프레임 dense T_world_obj이고 source는 generated다", () => {
    const cup = shot.subjects.find((subject) => subject.id === SUBJECT_IDS.cup);
    expect(cup && cup.kind !== "light" && cup.motion.channel).toBe("unset");
    const stream = poses.objectStream(SUBJECT_IDS.cup);
    expect(stream?.source).toBe("generated");
    expect(stream?.frames).toHaveLength(FIXTURE_DURATION_FRAMES);
    expect(stream?.frames.map((frame) => frame.t)).toEqual(
      Array.from({ length: FIXTURE_DURATION_FRAMES }, (_, frame) => frame),
    );
    const placed = stream?.frames.filter((frame) => frame.t >= CUP_PLACE_FRAME) ?? [];
    for (const frame of placed) nearly(translationOf(frame.T_world_obj), TABLE_POSITION);
    const held = translationOf(stream!.frames[16].T_world_obj);
    expect(held).not.toEqual([...TABLE_POSITION]);
  });

  it("컵을 쥐는 구간은 left_hand 로컬 offset이다", () => {
    const sample = samplePlayback(shot, preview, 16, poses);
    const cup = sample.objects.find((object) => object.subjectId === SUBJECT_IDS.cup);
    const wrist = sample.actors
      .find((actor) => actor.subjectId === SUBJECT_IDS.actorA)
      ?.joints.find((joint) => joint.name === "left_wrist");
    expect(cup?.parentSubjectId).toBe(SUBJECT_IDS.actorA);
    expect(cup?.parentRigPart).toBe("left_hand");
    expect(wrist).toBeTruthy();
    if (!cup || !wrist) return;
    const inverse: [number, number, number, number] = [-wrist.rotation[0], -wrist.rotation[1], -wrist.rotation[2], wrist.rotation[3]];
    const local = quatRotate(inverse, [
      cup.position[0] - wrist.position[0],
      cup.position[1] - wrist.position[1],
      cup.position[2] - wrist.position[2],
    ]);
    nearly(local, CUP_IN_HAND_OFFSET);
    const worldDelta = [
      cup.position[0] - wrist.position[0],
      cup.position[1] - wrist.position[1],
      cup.position[2] - wrist.position[2],
    ];
    expect(Math.hypot(worldDelta[0] - CUP_IN_HAND_OFFSET[0], worldDelta[1] - CUP_IN_HAND_OFFSET[1], worldDelta[2] - CUP_IN_HAND_OFFSET[2])).toBeGreaterThan(1e-3);
    const placed = samplePlayback(shot, preview, CUP_PLACE_FRAME, poses).objects.find((object) => object.subjectId === SUBJECT_IDS.cup);
    expect(placed?.parentSubjectId).toBe(SUBJECT_IDS.table);
    expect(placed?.parentRigPart).toBeUndefined();
    nearly(placed?.position ?? [], TABLE_POSITION);
  });

  it("두 사람 접촉은 contact_id로 찾고 a/b는 contact_graph에서 읽는다", () => {
    const span = readContact(HANDSHAKE_CONTACT_GRAPH, { kind: "contact", contact_id: HANDSHAKE_RANGE.contact_id });
    expect(HANDSHAKE_RANGE).toEqual({ kind: "contact", contact_id: "handshake_01" });
    expect(span.a).toEqual({ actor_id: SUBJECT_IDS.actorA, part: "right_hand" });
    expect(span.b).toEqual({ actor_id: SUBJECT_IDS.actorB, part: "right_hand" });
    expect([span.start_frame, span.end_frame]).toEqual([72, 112]);
    const contact = preview.contacts.find((item) => item.contactId === span.contact_id);
    expect(contact?.a).toEqual({ subjectId: span.a.actor_id, rigPart: span.a.part });
    expect(contact?.b).toEqual({ subjectId: span.b.actor_id, rigPart: span.b.part });
    expect(contact?.startFrame).toBe(span.start_frame);
    expect(contact?.endFrame).toBe(span.end_frame);
  });

  it("subject id는 접두사를 해석하지 않는다", () => {
    const opaqueId = "act_01EXAMPLE";
    const base = createHandshakeShot();
    const actor = base.subjects.find((subject) => subject.id === SUBJECT_IDS.actorA);
    const shotWithOpaqueId = parseShot({
      ...base,
      subjects: base.subjects.map((subject) => (subject.id === actor?.id ? { ...subject, id: opaqueId } : subject)),
    });
    const record = interactionPreviewSchema.parse({
      schemaVersion: 1,
      shotId: shotWithOpaqueId.id,
      worldAssetId: HANDSHAKE_WORLD_IDS.set,
      bindings: [{ subjectId: opaqueId, worldAssetId: HANDSHAKE_WORLD_IDS.actorA, label: "A", kind: "actor", color: "#fff" }],
      contacts: [],
    });
    const source: PoseSequenceSource = {
      source: "generated",
      actorPose: (subjectId, frame) => (
        subjectId === opaqueId
          ? { frame, position: [1, 2, 3], rotationEuler: [0.1, 0.2, 0.3], scale: [1, 1, 1], source: "generated" }
          : undefined
      ),
      objectStream: () => undefined,
      joints: () => ({}),
    };
    const played = samplePlayback(shotWithOpaqueId, record, 4, source);
    expect(played.actors.map((item) => item.subjectId)).toEqual([opaqueId]);
    expect(played.actors[0]?.root.rotationEuler).toEqual([0.1, 0.2, 0.3]);
    expect(played.actors[0]?.root.eulerOrder).toBe("XYZ");
  });
});
