import { parseShot } from "../shot/schema";
import { sampleSubjectPose } from "../shot/queries";
import type { Shot } from "../shot/types";
import { normalizeWorldAsset } from "../worlds/normalize";
import type { WorldAsset } from "../worlds/types";
import {
  GENERATED_POSE_SOURCE,
  interactionPreviewSchema,
  type ContactEvent,
  type InteractionPreviewRecord,
  type RigPart,
} from "./contract";
import { eulerToQuaternion } from "./eulerOrder";
import { addVec3, asVec3, quatFromAxisAngle, quatIdentity, quatMul, quatRotate, worldMatrix, type Quat, type Vec3 } from "./math";
import {
  poseSourceFromChannels,
  type AuthoredPoseChannel,
  type ObjectPoseStream,
  type PoseSequenceSource,
  type RotationKey,
  type ShotPoseFrame,
} from "./poseSource";
import { solveJoints } from "./rig";
import { readContact, type ContactGraphEntry, type ContactRangeRef } from "./contactGraph";

/**
 * Subject ids match the #29 handshake fixture. They are opaque strings.
 * `act_` / `obj_` ids from the unmerged world schema pass through the same path.
 * Nothing here imports `instanceLink`, `motionBake`, or the Video lane.
 */
export const HANDSHAKE_SHOT_ID = "shot-handshake-preview";
export const HANDSHAKE_TAKE_ID = "cam_fixture_handshake";

export const HANDSHAKE_WORLD_IDS = {
  set: "world-handshake-set",
  actorA: "world-handshake-actor-a",
  actorB: "world-handshake-actor-b",
  cup: "world-handshake-cup",
  table: "world-handshake-table",
} as const;

export const SUBJECT_IDS = {
  actorA: "inst_fixture_actor_a",
  actorB: "inst_fixture_actor_b",
  cup: "inst_fixture_cup",
  table: "inst_fixture_table",
} as const;

/** 8 seconds. Playback reads these only after they are stored on `Shot.time`. */
export const FIXTURE_FPS = 16;
export const FIXTURE_DURATION_FRAMES = 128;

/** Frame the cup's parent becomes the table. Hold is `[0, CUP_PLACE_FRAME)`. */
export const CUP_PLACE_FRAME = 48;

/**
 * World positions from the Phase 0 demo (+Y up, meters).
 * Tabletop and the placed cup share one point. Actor roots do not travel.
 */
export const TABLE_POSITION: readonly [number, number, number] = [1.25, 0.72, 0.1];
export const ACTOR_A_ROOT: readonly [number, number, number] = [1.001, 0.38, -0.309];
export const ACTOR_B_ROOT: readonly [number, number, number] = [2.001, 0.38, -0.309];

/** Wrist-to-cup offset in A's `left_hand` frame. Not a world position. */
export const CUP_IN_HAND_OFFSET: Vec3 = [0.03, 0.02, 0.05];

const FIXTURE_CLOCK = "2026-11-12T00:00:00.000Z";
const ROOT_EULER: [number, number, number] = [0, 0, 0];

/** Handshake span. Endpoints live on this entry, not on the range ref. */
export const HANDSHAKE_RANGE: ContactRangeRef = { kind: "contact", contact_id: "handshake_01" };

export const HANDSHAKE_CONTACT_GRAPH: readonly ContactGraphEntry[] = [
  {
    contact_id: "handshake_01",
    a: { actor_id: SUBJECT_IDS.actorA, part: "right_hand" },
    b: { actor_id: SUBJECT_IDS.actorB, part: "right_hand" },
    start_frame: 72,
    end_frame: 112,
    type: "grasp",
  },
  {
    contact_id: "cup_hold_01",
    a: { actor_id: SUBJECT_IDS.actorA, part: "left_hand" },
    b: { object_id: SUBJECT_IDS.cup },
    start_frame: 0,
    end_frame: CUP_PLACE_FRAME,
    type: "grasp",
  },
];

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

/** Worlds so TargetResolver can tell A, B, the cup, and the table apart by `WorldAsset.id`. */
export const createHandshakeWorlds = (): WorldAsset[] => [
  world(HANDSHAKE_WORLD_IDS.set, "Indoor Set", { ko: "실내 세트", en: "Indoor Set" }, ["배경", "background"], "room"),
  world(HANDSHAKE_WORLD_IDS.actorA, "A", { ko: "A", en: "A" }, ["인물 A"], "actor_mark"),
  world(HANDSHAKE_WORLD_IDS.actorB, "B", { ko: "B", en: "B" }, ["인물 B"], "actor_mark"),
  world(HANDSHAKE_WORLD_IDS.cup, "Cup", { ko: "컵", en: "Cup" }, ["cup"], "socket"),
  world(HANDSHAKE_WORLD_IDS.table, "Table", { ko: "테이블", en: "Table" }, ["table"], "socket"),
];

const carryShoulder = quatMul(ry(0.25), rx(-0.9));
const carryElbow = rx(-1.05);
const reachShoulder = quatMul(ry(0.2), rx(-1.4));
const reachElbow = rx(-0.4);
const lowerShoulder = quatMul(ry(-0.35), rx(-0.7));
const lowerElbow = rx(-0.85);

const channel = (
  id: string,
  subjectId: string,
  rigPart: RigPart,
  contactId: string,
  joints: Record<string, RotationKey[]>,
): AuthoredPoseChannel => ({ id, subjectId, rigPart, contactId, joints });

const sideOf = (part: RigPart): "left" | "right" => (part.startsWith("left_") ? "left" : "right");

const armKeys = (part: RigPart, shoulder: Quat, elbow: Quat, frames: readonly number[]): Record<string, RotationKey[]> => {
  const side = sideOf(part);
  return {
    [`${side}_shoulder`]: frames.map((frame, index) => key(frame, index === frames.length - 1 ? lowerShoulder : shoulder)),
    [`${side}_elbow`]: frames.map((frame, index) => key(frame, index === frames.length - 1 ? lowerElbow : elbow)),
  };
};

const handshakeSpan = readContact(HANDSHAKE_CONTACT_GRAPH, HANDSHAKE_RANGE);
const cupHoldSpan = readContact(HANDSHAKE_CONTACT_GRAPH, { kind: "contact", contact_id: "cup_hold_01" });

const actorEndpoint = (entry: ContactGraphEntry, side: "a" | "b"): { actor_id: string; part: RigPart } => {
  const endpoint = entry[side];
  if (!endpoint.actor_id || !endpoint.part) {
    throw new Error(`${entry.contact_id}.${side}에는 actor와 part가 있어야 합니다.`);
  }
  return { actor_id: endpoint.actor_id, part: endpoint.part };
};

const handshakeA = actorEndpoint(handshakeSpan, "a");
const handshakeB = actorEndpoint(handshakeSpan, "b");

/**
 * Handshake channels take actor and part from `contact_graph[]`.
 * The exit edit moves B to the left hand without rewriting the graph or these channels.
 * `actionGraph.ts` is not imported.
 */
const HANDSHAKE_CHANNELS: readonly AuthoredPoseChannel[] = [
  channel("a-cup", cupHoldSpan.a.actor_id, cupHoldSpan.a.part, cupHoldSpan.contact_id, {
    [`${sideOf(cupHoldSpan.a.part)}_shoulder`]: [key(0, carryShoulder), key(32, carryShoulder), key(47, lowerShoulder), key(80, rx(-0.15))],
    [`${sideOf(cupHoldSpan.a.part)}_elbow`]: [key(0, carryElbow), key(32, carryElbow), key(47, lowerElbow), key(80, rx(-0.2))],
  }),
  channel(
    "a-handshake",
    handshakeA.actor_id,
    handshakeA.part,
    handshakeSpan.contact_id,
    armKeys(handshakeA.part, reachShoulder, reachElbow, [handshakeSpan.start_frame, 90, handshakeSpan.end_frame - 1]),
  ),
  channel(
    "b-handshake",
    handshakeB.actor_id,
    handshakeB.part,
    handshakeSpan.contact_id,
    armKeys(handshakeB.part, reachShoulder, reachElbow, [handshakeSpan.start_frame, 90, handshakeSpan.end_frame - 1]),
  ),
];

const handshakeContacts = (): ContactEvent[] => [
  {
    contactId: handshakeSpan.contact_id,
    kind: "hand_hand",
    startFrame: handshakeSpan.start_frame,
    endFrame: handshakeSpan.end_frame,
    a: { subjectId: handshakeA.actor_id, rigPart: handshakeA.part },
    b: { subjectId: handshakeB.actor_id, rigPart: handshakeB.part },
    actionType: handshakeSpan.type,
  },
  {
    contactId: cupHoldSpan.contact_id,
    kind: "hand_object",
    startFrame: cupHoldSpan.start_frame,
    endFrame: cupHoldSpan.end_frame,
    a: { subjectId: cupHoldSpan.a.actor_id, rigPart: cupHoldSpan.a.part },
    b: { subjectId: cupHoldSpan.b.object_id ?? SUBJECT_IDS.cup },
    actionType: cupHoldSpan.type,
  },
  {
    contactId: "cup_place_01",
    kind: "object_surface",
    startFrame: CUP_PLACE_FRAME,
    endFrame: FIXTURE_DURATION_FRAMES,
    a: { subjectId: SUBJECT_IDS.cup },
    b: { subjectId: SUBJECT_IDS.table },
    actionType: "place",
  },
];

const poseKey = (
  frame: number,
  position: readonly [number, number, number],
  rotationEuler: readonly [number, number, number],
) => ({ frame, position: [...position], rotationEuler: [...rotationEuler], scale: [1, 1, 1] });

/** Stage subjects, A's root motion, and the camera take. Pelvis rotation is XYZ euler. */
export const createHandshakeShot = (): Shot => parseShot({
  schemaVersion: 1,
  id: HANDSHAKE_SHOT_ID,
  name: "Handshake",
  time: { fps: FIXTURE_FPS, durationFrames: FIXTURE_DURATION_FRAMES, origin: "clip_local" },
  environment: { worldId: HANDSHAKE_WORLD_IDS.set },
  subjects: [
    {
      id: SUBJECT_IDS.actorA,
      assetId: HANDSHAKE_WORLD_IDS.actorA,
      assetVersion: 1,
      name: "A",
      uri: `worlds/${HANDSHAKE_WORLD_IDS.actorA}`,
      kind: "human",
      representation: "marker",
      visible: true,
      locked: false,
      placement: { position: [...ACTOR_A_ROOT], rotationEuler: ROOT_EULER, scale: [1, 1, 1] },
      motion: {
        channel: "explicit",
        interpolation: "linear",
        provenance: { kind: "keyed" },
        keys: [
          poseKey(0, ACTOR_A_ROOT, ROOT_EULER),
          poseKey(64, ACTOR_A_ROOT, ROOT_EULER),
          poseKey(127, ACTOR_A_ROOT, ROOT_EULER),
        ],
      },
    },
    {
      id: SUBJECT_IDS.actorB,
      assetId: HANDSHAKE_WORLD_IDS.actorB,
      assetVersion: 1,
      name: "B",
      uri: `worlds/${HANDSHAKE_WORLD_IDS.actorB}`,
      kind: "human",
      representation: "marker",
      visible: true,
      locked: false,
      placement: { position: [...ACTOR_B_ROOT], rotationEuler: ROOT_EULER, scale: [1, 1, 1] },
      motion: { channel: "unset" },
    },
    {
      id: SUBJECT_IDS.cup,
      assetId: HANDSHAKE_WORLD_IDS.cup,
      assetVersion: 1,
      name: "컵",
      uri: `worlds/${HANDSHAKE_WORLD_IDS.cup}`,
      kind: "object",
      representation: "sphere",
      visible: true,
      locked: false,
      placement: {
        position: [TABLE_POSITION[0], TABLE_POSITION[1], TABLE_POSITION[2]],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
      motion: { channel: "unset" },
    },
    {
      id: SUBJECT_IDS.table,
      assetId: HANDSHAKE_WORLD_IDS.table,
      assetVersion: 1,
      name: "테이블",
      uri: `worlds/${HANDSHAKE_WORLD_IDS.table}`,
      kind: "object",
      representation: "box",
      visible: true,
      locked: false,
      placement: {
        position: [TABLE_POSITION[0], TABLE_POSITION[1], TABLE_POSITION[2]],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
      motion: { channel: "unset" },
    },
  ],
  camera: {
    status: "ready",
    lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
    interpolation: "linear",
    selectedTakeId: HANDSHAKE_TAKE_ID,
    takes: [
      {
        schemaVersion: 1,
        id: HANDSHAKE_TAKE_ID,
        name: "Handshake",
        source: "preset",
        createdAt: FIXTURE_CLOCK,
        keys: [
          { frame: 0, position: [1.5, 1.7, 2.6], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
          { frame: 64, position: [1.5, 1.55, 2.2], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
          { frame: 127, position: [1.5, 1.45, 1.9], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
        ],
      },
    ],
  },
  renders: [],
});

const identity = quatIdentity();

/** Contact graph. Overrides start empty, so B's handshake hand is the right hand. */
export const createHandshakePreviewRecord = (): InteractionPreviewRecord => interactionPreviewSchema.parse({
  schemaVersion: 1,
  shotId: HANDSHAKE_SHOT_ID,
  worldAssetId: HANDSHAKE_WORLD_IDS.set,
  bindings: [
    { subjectId: SUBJECT_IDS.actorA, worldAssetId: HANDSHAKE_WORLD_IDS.actorA, label: "A", kind: "actor", color: "#7eb6ff" },
    { subjectId: SUBJECT_IDS.actorB, worldAssetId: HANDSHAKE_WORLD_IDS.actorB, label: "B", kind: "actor", color: "#f0a36b" },
    { subjectId: SUBJECT_IDS.cup, worldAssetId: HANDSHAKE_WORLD_IDS.cup, label: "컵", kind: "prop", color: "#1ad6b4" },
    { subjectId: SUBJECT_IDS.table, worldAssetId: HANDSHAKE_WORLD_IDS.table, label: "테이블", kind: "set_piece", color: "#8d6b4a" },
  ],
  contacts: handshakeContacts(),
  attachmentOffsets: {
    [SUBJECT_IDS.cup]: {
      cup_hold_01: { translation: CUP_IN_HAND_OFFSET, rotation: identity },
      cup_place_01: { translation: [0, 0, 0], rotation: identity },
    },
  },
  overrides: [],
});

const pelvisOf = (shot: Shot, subjectId: string, frame: number): ShotPoseFrame | undefined => {
  const subject = shot.subjects.find((item) => item.id === subjectId);
  if (!subject || subject.kind === "light") return undefined;
  const pose = sampleSubjectPose(subject, frame);
  return {
    frame,
    position: pose.position,
    rotationEuler: pose.rotationEuler,
    scale: pose.scale,
    source: GENERATED_POSE_SOURCE,
  };
};

/**
 * Playback pose for the demo.
 * Actor pelvis is the shot pose (`rotationEuler` XYZ). The cup is every frame of
 * `Shot.time` as dense `T_world_obj` with `source: "generated"`.
 * Pass resolved contacts so B's effector retargets without rewriting the shot.
 */
export const createHandshakePoseSource = (
  shot: Shot,
  contacts: readonly ContactEvent[],
): PoseSequenceSource => {
  const joints = poseSourceFromChannels(HANDSHAKE_CHANNELS, contacts);
  let cupStream: ObjectPoseStream | undefined;
  const objectStream = (subjectId: string): ObjectPoseStream | undefined => {
    if (subjectId !== SUBJECT_IDS.cup) return undefined;
    if (!cupStream) cupStream = denseCupStream(shot, joints);
    return cupStream;
  };
  return {
    source: GENERATED_POSE_SOURCE,
    actorPose: (subjectId, frame) => pelvisOf(shot, subjectId, Math.floor(frame)),
    objectStream,
    joints: joints.joints,
  };
};

const denseCupStream = (shot: Shot, joints: Pick<PoseSequenceSource, "joints">): ObjectPoseStream => {
  const frameCount = shot.time.durationFrames;
  const frames = [];
  for (let t = 0; t < frameCount; t += 1) {
    const position = t < CUP_PLACE_FRAME ? cupOnHand(shot, joints, t) : asVec3(TABLE_POSITION);
    frames.push({ t, T_world_obj: worldMatrix(position) });
  }
  return {
    objectId: SUBJECT_IDS.cup,
    subjectId: SUBJECT_IDS.cup,
    source: GENERATED_POSE_SOURCE,
    frames,
  };
};

const cupOnHand = (shot: Shot, joints: Pick<PoseSequenceSource, "joints">, frame: number): Vec3 => {
  const pelvis = pelvisOf(shot, SUBJECT_IDS.actorA, frame);
  if (!pelvis) return asVec3(TABLE_POSITION);
  const solved = solveJoints(
    asVec3(pelvis.position),
    eulerToQuaternion(pelvis.rotationEuler),
    joints.joints(SUBJECT_IDS.actorA, frame),
  );
  const wrist = solved.find((joint) => joint.name === "left_wrist");
  if (!wrist) return asVec3(pelvis.position);
  // Hand-local offset. `phase0LeftHandWorldPose` is only on the unmerged world branch.
  return addVec3(wrist.position, quatRotate(wrist.rotation, CUP_IN_HAND_OFFSET));
};
