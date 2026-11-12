import { describe, expect, it } from "vitest";
import type { ContactGraph } from "./actionGraph";
import { ContactSolver } from "./contactSolver";
import type { ActorPoseSequence } from "./motionModel";
import { GENERATED_MOTION_SOURCE, translationOf } from "./objectStream";
import { jointIndex, SmplxSkeleton, Vec } from "./pose";

const ACTOR_A = "inst_fixture_actor_a";
const ACTOR_B = "inst_fixture_actor_b";
const CUP = "inst_fixture_cup";

const pose = (actorId: string, pelvis: [number, number, number]): ActorPoseSequence => ({
  actorId,
  source: GENERATED_MOTION_SOURCE,
  frames: Array.from({ length: 8 }, (_, frame) => ({
    frame,
    joints: SmplxSkeleton.restPose(pelvis),
  })),
});

const grasp = (part: "right_hand" | "left_hand"): ContactGraph => ({
  contact_id: "handshake_01",
  a: { actor_id: ACTOR_A, part: "right_hand" },
  b: { actor_id: ACTOR_B, part },
  start_frame: 2,
  end_frame: 6,
  type: "grasp",
});

const wrist = (sequence: ActorPoseSequence, frame: number, name: "right_wrist" | "left_wrist") =>
  sequence.frames[frame]?.joints[jointIndex(name)]?.translation;

describe("contact solver", () => {
  const sequences = [pose(ACTOR_A, [-0.2, 0.95, 0.15]), pose(ACTOR_B, [0.55, 0.95, 0.15])];

  it("fits a handshake by moving only B's named hand onto A's hand", () => {
    const right = ContactSolver.solve({
      sequences,
      contacts: [grasp("right_hand")],
      frameCount: 8,
      locateObject: () => undefined,
      locateSurface: () => undefined,
    });
    const left = ContactSolver.solve({
      sequences,
      contacts: [grasp("left_hand")],
      frameCount: 8,
      locateObject: () => undefined,
      locateSurface: () => undefined,
    });
    const rightB = right.sequences.find((sequence) => sequence.actorId === ACTOR_B);
    const leftB = left.sequences.find((sequence) => sequence.actorId === ACTOR_B);
    const anchor = right.sequences.find((sequence) => sequence.actorId === ACTOR_A);
    const originalA = sequences[0]!;
    const originalB = sequences[1]!;
    expect(anchor?.frames).toEqual(originalA.frames);
    expect(rightB?.source).toBe(GENERATED_MOTION_SOURCE);
    expect(rightB?.frames[4]?.joints[SmplxSkeleton.pelvisIndex]).toEqual(originalB.frames[4]?.joints[SmplxSkeleton.pelvisIndex]);
    expect(leftB?.frames[4]?.joints[SmplxSkeleton.pelvisIndex]).toEqual(originalB.frames[4]?.joints[SmplxSkeleton.pelvisIndex]);
    const anchorWrist = wrist(originalA, 4, "right_wrist");
    expect(anchorWrist).toBeDefined();
    if (!anchorWrist || !rightB || !leftB) return;
    expect(Vec.length(Vec.sub(wrist(rightB, 4, "right_wrist")!, anchorWrist))).toBeLessThan(1e-3);
    expect(wrist(rightB, 4, "left_wrist")).toEqual(wrist(originalB, 4, "left_wrist"));
    expect(Vec.length(Vec.sub(wrist(leftB, 4, "left_wrist")!, anchorWrist))).toBeLessThan(1e-3);
    expect(wrist(leftB, 4, "right_wrist")).toEqual(wrist(originalB, 4, "right_wrist"));
    expect(wrist(rightB, 0, "right_wrist")).toEqual(wrist(originalB, 0, "right_wrist"));
    expect(right.contacts[0]?.resolved).toBe(true);
    expect(left.contacts[0]?.b.part).toBe("left_hand");
  });

  it("parents the cup on A's left hand, then writes a dense table transform", () => {
    const actor = pose(ACTOR_A, [-0.2, 0.95, 0.15]);
    const hold: ContactGraph = {
      contact_id: "cup_hold_01",
      a: { actor_id: ACTOR_A, part: "left_hand" },
      b: { object_id: CUP },
      start_frame: 0,
      end_frame: 3,
      type: "grasp",
    };
    const place: ContactGraph = {
      contact_id: "cup_place_01",
      a: { actor_id: ACTOR_A, part: "left_hand" },
      b: { object_id: CUP },
      start_frame: 2,
      end_frame: 7,
      type: "place",
    };
    const cup = { position: [0.2, 1.2, 0.1] as [number, number, number], subjectId: CUP };
    const table = { position: [-0.45, 1.25, 0.3] as [number, number, number], subjectId: "inst_fixture_table" };
    const placed = ContactSolver.solve({
      sequences: [actor],
      contacts: [hold, place],
      frameCount: 8,
      locateObject: (objectId) => (objectId === CUP ? cup : undefined),
      locateSurface: (query) => (query === "table" ? table : undefined),
    });
    expect(placed.contacts.every((contact) => contact.resolved)).toBe(true);
    const stream = placed.objects[0];
    expect(stream?.source).toBe(GENERATED_MOTION_SOURCE);
    expect(stream?.frames.map((frame) => frame.t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const held = translationOf(stream!.frames[0]!.T_world_obj);
    expect(held[0]).toBeCloseTo(wrist(actor, 0, "left_wrist")![0], 5);
    expect(held[1]).toBeCloseTo(wrist(actor, 0, "left_wrist")![1], 5);
    expect(held[2]).toBeCloseTo(wrist(actor, 0, "left_wrist")![2], 5);
    for (const frame of [4, 5, 6, 7]) {
      const position = translationOf(stream!.frames[frame]!.T_world_obj);
      expect(position[0]).toBeCloseTo(table.position[0], 5);
      expect(position[1]).toBeCloseTo(table.position[1], 5);
      expect(position[2]).toBeCloseTo(table.position[2], 5);
    }
    expect(stream?.frames[4]?.T_world_obj).toEqual(stream?.frames[7]?.T_world_obj);
    expect(placed.attachments[0]).toMatchObject({
      objectId: CUP,
      parentId: ACTOR_A,
      rigPart: "left_hand",
      sourceContactId: "cup_hold_01",
      startFrame: 0,
      endFrame: 4,
    });
    expect(placed.attachments[1]).toEqual({
      objectId: CUP,
      parentId: "inst_fixture_table",
      sourceContactId: "cup_place_01",
      startFrame: 4,
      endFrame: 8,
    });
    expect(placed.attachments[1]?.rigPart).toBeUndefined();
    const solvedActor = placed.sequences[0]!;
    expect(solvedActor.frames[3]?.joints[SmplxSkeleton.pelvisIndex]?.translation).toEqual(
      actor.frames[3]?.joints[SmplxSkeleton.pelvisIndex]?.translation,
    );
    expect(Vec.length(Vec.sub(wrist(solvedActor, 3, "left_wrist")!, table.position))).toBeLessThan(1e-3);
    expect(wrist(solvedActor, 0, "left_wrist")).toEqual(wrist(actor, 0, "left_wrist"));

    const missed = ContactSolver.solve({
      sequences: [actor],
      contacts: [hold, place],
      frameCount: 8,
      locateObject: () => undefined,
      locateSurface: () => table,
    });
    expect(missed.contacts.every((contact) => contact.resolved === false)).toBe(true);
    expect(missed.objects).toEqual([]);
    expect(missed.attachments).toEqual([]);
    expect(missed.sequences[0]?.frames).toEqual(actor.frames);
  });
});
