import { normalizeWorldAsset } from "../worlds/normalize";
import type { WorldAsset } from "../worlds/types";
import { contactsFromActionGraph } from "./actionGraph";
import {
  interactiveSceneSchema,
  type ActionGraphContact,
  type InteractiveScene,
  type RigPart,
  type RotationKey,
} from "./contract";
import { quatFromAxisAngle, quatIdentity, quatMul, type Quat, type Vec3 } from "./math";

/**
 * Provisional ids. World lane replaces instance ids; CameraTrack replaces the track id.
 * Do not parse these strings.
 */
export const HANDSHAKE_SCENE_ID = "scene-handshake-preview";

export const HANDSHAKE_WORLD_IDS = {
  set: "world-handshake-set",
  actorA: "world-handshake-actor-a",
  actorB: "world-handshake-actor-b",
  cup: "world-handshake-cup",
  table: "world-handshake-table",
} as const;

export const FIXTURE_INSTANCE_IDS = {
  actorA: "inst_fixture_actor_a",
  actorB: "inst_fixture_actor_b",
  cup: "inst_fixture_cup",
  table: "inst_fixture_table",
} as const;

export const FIXTURE_CAMERA_TRACK_ID = "cam_fixture_handshake";

const FIXTURE_CLOCK = "2026-11-04T00:00:00.000Z";

const yaw = (radians: number): Quat => quatFromAxisAngle([0, 1, 0], radians);
const rx = (radians: number): Quat => quatFromAxisAngle([1, 0, 0], radians);
const ry = (radians: number): Quat => quatFromAxisAngle([0, 1, 0], radians);

const key = (frame: number, rotation: Quat): RotationKey => ({ frame, rotation });

const world = (
  id: string,
  name: string,
  localized: { ko: string; en: string },
  aliases: string[],
  elementKind: "room" | "actor_mark" | "socket",
): WorldAsset =>
  normalizeWorldAsset({
    id,
    name,
    aliases,
    localizedNames: localized,
    description: `${name} handshake preview`,
    representation: "mesh",
    coordinateSystem: "Y_UP",
    unitScaleMeters: 1,
    createdAt: FIXTURE_CLOCK,
    updatedAt: FIXTURE_CLOCK,
    elements: [
      {
        id: `elem-${id}`,
        name: localized.ko,
        aliases,
        localizedNames: localized,
        kind: elementKind,
        description: name,
      },
    ],
    props: elementKind === "socket" ? [localized.en, localized.ko] : [],
  });

/** Worlds the preview registers so TargetResolver can tell A, B, the cup, and the table apart. */
export const createHandshakeWorlds = (): WorldAsset[] => [
  world(HANDSHAKE_WORLD_IDS.set, "Indoor Set", { ko: "실내 세트", en: "Indoor Set" }, ["배경", "background"], "room"),
  world(HANDSHAKE_WORLD_IDS.actorA, "A", { ko: "A", en: "A" }, ["인물 A"], "actor_mark"),
  world(HANDSHAKE_WORLD_IDS.actorB, "B", { ko: "B", en: "B" }, ["인물 B"], "actor_mark"),
  world(HANDSHAKE_WORLD_IDS.cup, "Cup", { ko: "컵", en: "Cup" }, ["cup"], "socket"),
  world(HANDSHAKE_WORLD_IDS.table, "Table", { ko: "테이블", en: "Table" }, ["table"], "socket"),
];

/**
 * Action Graph rows for the representative line:
 * A approaches B and they shake hands; B sets the cup from the left hand onto the table.
 * `end_frame` is inclusive, matching Action Graph v0.1.
 */
export const handshakeActionGraphContacts = (): ActionGraphContact[] => {
  const a = FIXTURE_INSTANCE_IDS.actorA;
  const b = FIXTURE_INSTANCE_IDS.actorB;
  const rows: ActionGraphContact[] = [
    {
      contact_id: "handshake_01",
      a: { actor_id: a, part: "right_hand" },
      b: { actor_id: b, part: "left_hand" },
      start_frame: 28,
      end_frame: 51,
      type: "grasp",
    },
    {
      contact_id: "cup_hold_01",
      a: { actor_id: b, part: "left_hand" },
      b: { object_id: FIXTURE_INSTANCE_IDS.cup },
      start_frame: 0,
      end_frame: 39,
      type: "grasp",
    },
    {
      contact_id: "cup_place_01",
      a: { actor_id: b, part: "left_hand" },
      b: { object_id: FIXTURE_INSTANCE_IDS.table },
      start_frame: 40,
      end_frame: 80,
      type: "place",
    },
  ];
  return rows;
};

const carryShoulder = quatMul(ry(0.25), rx(-0.9));
const carryElbow = rx(-1.05);
const reachShoulder = quatMul(ry(0.2), rx(-1.4));
const reachElbow = rx(-0.4);
const lowerShoulder = quatMul(ry(-0.35), rx(-0.7));
const lowerElbow = rx(-0.85);

/**
 * Build the preview scene. Source contacts come from the action graph adapter.
 * Overrides start empty, so B's handshake hand is the left hand.
 */
export const createHandshakePreviewScene = (): InteractiveScene => {
  const a = FIXTURE_INSTANCE_IDS.actorA;
  const b = FIXTURE_INSTANCE_IDS.actorB;
  const cup = FIXTURE_INSTANCE_IDS.cup;
  const table = FIXTURE_INSTANCE_IDS.table;
  const identity = quatIdentity();
  const contacts = contactsFromActionGraph(handshakeActionGraphContacts(), {
    heldObjectInstanceId: (actorInstanceId: string, part: RigPart) =>
      actorInstanceId === b && part === "left_hand" ? cup : undefined,
  });
  const scene: InteractiveScene = {
    schemaVersion: 1,
    id: HANDSHAKE_SCENE_ID,
    worldAssetId: HANDSHAKE_WORLD_IDS.set,
    fps: 24,
    frameCount: 81,
    subjects: [
      { worldAssetId: HANDSHAKE_WORLD_IDS.actorA, instanceId: a, label: "A", kind: "actor", color: "#7eb6ff" },
      { worldAssetId: HANDSHAKE_WORLD_IDS.actorB, instanceId: b, label: "B", kind: "actor", color: "#f0a36b" },
      { worldAssetId: HANDSHAKE_WORLD_IDS.cup, instanceId: cup, label: "컵", kind: "object", color: "#1ad6b4" },
      { worldAssetId: HANDSHAKE_WORLD_IDS.table, instanceId: table, label: "테이블", kind: "object", color: "#8d6b4a" },
    ],
    poses: [
      {
        instanceId: a,
        root: [
          { frame: 0, translation: [-1.15, 0, 0.15], rotation: yaw(Math.PI / 2) },
          { frame: 34, translation: [-0.22, 0, 0.15], rotation: yaw(Math.PI / 2) },
          { frame: 80, translation: [-0.22, 0, 0.15], rotation: yaw(Math.PI / 2) },
        ],
        channels: [
          {
            id: "a-handshake",
            actorInstanceId: a,
            rigPart: "right_hand",
            contactId: "handshake_01",
            joints: {
              right_shoulder: [key(24, reachShoulder), key(40, reachShoulder), key(56, rx(-0.2))],
              right_elbow: [key(24, reachElbow), key(40, reachElbow), key(56, rx(-0.25))],
            },
          },
        ],
      },
      {
        instanceId: b,
        root: [
          { frame: 0, translation: [0.62, 0, 0.15], rotation: yaw(-Math.PI / 2) },
          { frame: 80, translation: [0.62, 0, 0.15], rotation: yaw(-Math.PI / 2) },
        ],
        channels: [
          {
            id: "b-cup",
            actorInstanceId: b,
            rigPart: "left_hand",
            contactId: "cup_hold_01",
            joints: {
              left_shoulder: [key(0, carryShoulder), key(28, carryShoulder), key(39, lowerShoulder), key(70, rx(-0.15))],
              left_elbow: [key(0, carryElbow), key(28, carryElbow), key(39, lowerElbow), key(70, rx(-0.2))],
            },
          },
          {
            id: "b-handshake",
            actorInstanceId: b,
            rigPart: "left_hand",
            contactId: "handshake_01",
            joints: {
              left_shoulder: [key(28, reachShoulder), key(44, reachShoulder), key(51, lowerShoulder)],
              left_elbow: [key(28, reachElbow), key(44, reachElbow), key(51, lowerElbow)],
            },
          },
        ],
      },
    ],
    objects: [
      {
        instanceId: table,
        worldAssetId: HANDSHAKE_WORLD_IDS.table,
        role: "set_piece",
        motionMode: "static",
        rest: { translation: [1.25, 0.72, 0.1], rotation: identity, scale: [0.7, 0.06, 0.5] },
        attachmentOffsets: {},
      },
      {
        instanceId: cup,
        worldAssetId: HANDSHAKE_WORLD_IDS.cup,
        role: "prop",
        motionMode: "dynamic",
        rest: { translation: [1.3, 0.88, 0.1], rotation: identity, scale: [0.18, 0.26, 0.18] },
        attachmentOffsets: {
          cup_hold_01: { translation: [0, -0.16, 0.1], rotation: identity },
          cup_place_01: { translation: [0.05, 0.16, 0], rotation: identity },
        },
      },
    ],
    contacts,
    camera: {
      cameraTrackId: FIXTURE_CAMERA_TRACK_ID,
      samples: [
        { frame: 0, position: [0.05, 1.55, 3.15], rotation: identity },
        { frame: 40, position: [0.22, 1.48, 2.7], rotation: identity },
        { frame: 80, position: [0.38, 1.42, 2.4], rotation: identity },
      ],
    },
    overrides: [],
  };
  return interactiveSceneSchema.parse(scene);
};

const replaceId = (value: string, map: Readonly<Record<string, string>>): string => map[value] ?? value;

/**
 * Swap opaque instance ids. World asset ids, contact ids, and camera track ids stay.
 * Playback keys everything by instance id, so the same scene samples after a full remap.
 * Returns a newly validated scene. Does not mutate `scene`.
 */
export const rebindInstanceIds = (scene: InteractiveScene, map: Readonly<Record<string, string>>): InteractiveScene => {
  const id = (value: string) => replaceId(value, map);
  return interactiveSceneSchema.parse({
    ...scene,
    subjects: scene.subjects.map((subject) => ({ ...subject, instanceId: id(subject.instanceId) })),
    poses: scene.poses.map((pose) => ({
      ...pose,
      instanceId: id(pose.instanceId),
      channels: pose.channels.map((channel) => ({ ...channel, actorInstanceId: id(channel.actorInstanceId) })),
    })),
    objects: scene.objects.map((object) => ({ ...object, instanceId: id(object.instanceId) })),
    contacts: scene.contacts.map((contact) => ({
      ...contact,
      a: { ...contact.a, instanceId: id(contact.a.instanceId) },
      b: { ...contact.b, instanceId: id(contact.b.instanceId) },
    })),
    overrides: scene.overrides.map((override) => ({ ...override, instanceId: id(override.instanceId) })),
  });
};
