import { describe, expect, it } from "vitest";
import { createMeshExampleWorld } from "../worlds/sampleWorlds";
import { contactsFromActionGraph } from "./actionGraph";
import {
  FIXTURE_CAMERA_TRACK_ID,
  FIXTURE_INSTANCE_IDS,
  HANDSHAKE_WORLD_IDS,
  createHandshakePreviewScene,
  createHandshakeWorlds,
  handshakeActionGraphContacts,
  rebindInstanceIds,
} from "./fixture";
import { distance } from "./math";
import { frameAtTime, jointPosition, materializeAttachments, resolveContacts, samplePlayback } from "./playback";
import { resolveSubjectByName } from "./resolveSubject";

const scene = () => createHandshakePreviewScene();

describe("handshake preview playback", () => {
  it("turns the action graph into hand-hand, hand-cup, and cup-table contacts", () => {
    const contacts = contactsFromActionGraph(handshakeActionGraphContacts(), {
      heldObjectInstanceId: (actorId, part) =>
        actorId === FIXTURE_INSTANCE_IDS.actorB && part === "left_hand" ? FIXTURE_INSTANCE_IDS.cup : undefined,
    });
    expect(contacts.map((contact) => [contact.contactId, contact.kind, contact.startFrame, contact.endFrame])).toEqual([
      ["handshake_01", "hand_hand", 28, 52],
      ["cup_hold_01", "hand_object", 0, 40],
      ["cup_place_01", "object_surface", 40, 81],
    ]);
    expect(contacts[0]?.b.rigPart).toBe("left_hand");
    expect(scene().contacts).toEqual(contacts);
  });

  it("maps LoopClock seconds onto shot-local frames", () => {
    const shot = scene();
    expect(frameAtTime(0, shot.fps, shot.frameCount)).toBe(0);
    expect(frameAtTime(0.5, shot.fps, shot.frameCount)).toBe(12);
    expect(frameAtTime(80 / shot.fps, shot.fps, shot.frameCount)).toBe(80);
    expect(frameAtTime(10, shot.fps, shot.frameCount)).toBe(80);
  });

  it("walks A toward B, then parents the cup from the left hand onto the table", () => {
    const shot = scene();
    const early = samplePlayback(shot, 8);
    const meet = samplePlayback(shot, 36);
    const placed = samplePlayback(shot, 60);
    const actorA = early.actors.find((actor) => actor.instanceId === FIXTURE_INSTANCE_IDS.actorA);
    const actorALater = meet.actors.find((actor) => actor.instanceId === FIXTURE_INSTANCE_IDS.actorA);
    expect(actorA).toBeDefined();
    expect(actorALater).toBeDefined();
    if (!actorA || !actorALater) return;
    expect(actorALater.root.translation[0]).toBeGreaterThan(actorA.root.translation[0] + 0.4);

    const cupEarly = early.objects.find((object) => object.instanceId === FIXTURE_INSTANCE_IDS.cup);
    const leftWrist = early.actors
      .find((actor) => actor.instanceId === FIXTURE_INSTANCE_IDS.actorB)
      ?.joints.find((joint) => joint.name === "left_wrist");
    expect(cupEarly?.parentRigPart).toBe("left_hand");
    expect(cupEarly?.sourceContactId).toBe("cup_hold_01");
    expect(leftWrist && cupEarly && distance(cupEarly.position, leftWrist.position)).toBeLessThan(0.25);
    expect(early.contacts.map((contact) => contact.contactId).sort()).toEqual(["cup_hold_01"]);

    expect(meet.contacts.map((contact) => contact.contactId).sort()).toEqual(["cup_hold_01", "handshake_01"]);
    const aHand = jointPosition(
      meet.actors.find((actor) => actor.instanceId === FIXTURE_INSTANCE_IDS.actorA)!,
      "right_wrist",
    );
    const bHand = jointPosition(
      meet.actors.find((actor) => actor.instanceId === FIXTURE_INSTANCE_IDS.actorB)!,
      "left_wrist",
    );
    expect(aHand && bHand && distance(aHand, bHand)).toBeLessThan(0.55);

    const cupLate = placed.objects.find((object) => object.instanceId === FIXTURE_INSTANCE_IDS.cup);
    const table = placed.objects.find((object) => object.instanceId === FIXTURE_INSTANCE_IDS.table);
    expect(cupLate?.parentInstanceId).toBe(FIXTURE_INSTANCE_IDS.table);
    expect(cupLate?.parentRigPart).toBeUndefined();
    expect(cupLate?.sourceContactId).toBe("cup_place_01");
    expect(table && cupLate && distance(cupLate.position, table.position)).toBeLessThan(0.2);
    expect(placed.contacts.map((contact) => contact.kind)).toEqual(["object_surface"]);
    expect(placed.camera.cameraTrackId).toBe(FIXTURE_CAMERA_TRACK_ID);
  });

  it("resolves A and B to different WorldAsset ids even when the apartment world is loaded", () => {
    const apartment = createMeshExampleWorld();
    const worlds = {
      [apartment.id]: apartment,
      ...Object.fromEntries(createHandshakeWorlds().map((asset) => [asset.id, asset])),
    };
    const subjects = scene().subjects;
    const a = resolveSubjectByName(worlds, subjects, "A", "ko");
    const b = resolveSubjectByName(worlds, subjects, "B", "ko");
    const cup = resolveSubjectByName(worlds, subjects, "컵", "ko");
    const table = resolveSubjectByName(worlds, subjects, "테이블", "ko");
    expect(a).toMatchObject({ worldAssetId: HANDSHAKE_WORLD_IDS.actorA, instanceId: FIXTURE_INSTANCE_IDS.actorA });
    expect(b).toMatchObject({ worldAssetId: HANDSHAKE_WORLD_IDS.actorB, instanceId: FIXTURE_INSTANCE_IDS.actorB });
    expect(cup).toMatchObject({ worldAssetId: HANDSHAKE_WORLD_IDS.cup });
    expect(table).toMatchObject({ worldAssetId: HANDSHAKE_WORLD_IDS.table });
    if ("worldAssetId" in a && "worldAssetId" in b) expect(a.worldAssetId).not.toBe(b.worldAssetId);
  });

  it("keeps sampling after instance ids are swapped", () => {
    const rebound = rebindInstanceIds(scene(), {
      [FIXTURE_INSTANCE_IDS.actorA]: "act_swap_a",
      [FIXTURE_INSTANCE_IDS.actorB]: "act_swap_b",
      [FIXTURE_INSTANCE_IDS.cup]: "obj_swap_cup",
      [FIXTURE_INSTANCE_IDS.table]: "obj_swap_table",
    });
    const frame = samplePlayback(rebound, 10);
    expect(frame.actors.map((actor) => actor.instanceId).sort()).toEqual(["act_swap_a", "act_swap_b"]);
    expect(materializeAttachments(rebound)[0]?.parentInstanceId).toBe("act_swap_b");
    expect(resolveContacts(rebound)[0]?.a.instanceId).toBe("act_swap_a");
    expect(rebound.worldAssetId).toBe(HANDSHAKE_WORLD_IDS.set);
    expect(rebound.subjects[0]?.worldAssetId).toBe(HANDSHAKE_WORLD_IDS.actorA);
  });
});
