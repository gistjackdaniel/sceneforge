import { performancePlanFromNode, type PerformancePlanParams } from "../performance/plan";
import type { Project } from "../project/types";
import { normalizeWorldAsset } from "../worlds/normalize";
import { sourceAxesFromWorldAsset } from "../worlds/coordinates";
import { migrateWorldToSceneState } from "../worlds/migrateInstances";
import {
  sceneStateSchema,
  SMPLX_PART_JOINT,
  type Asset,
  type AssetRevision,
  type RigPart,
  type SceneState,
} from "../worlds/sceneState";
import type { WorldAsset } from "../worlds/types";
import { eulerToQuaternion } from "./eulerAdapter";
import { linkPosedSubject } from "./instanceLink";
import { bakeDenseObjectMotion, worldMatrixFromShotPose, type DenseObjectFrame } from "./motionBake";
import { parseShot } from "./schema";
import { shotId, subjectId, takeId, type Quat, type Shot, type Vec3 } from "./types";

/**
 * Phase 0 demo shot from Backbone research (`docs/phase0`, PR #30).
 * Not installed as the editor's initial project: that boot scene is the color-block stage.
 *
 * Clock is `Shot.time` only: 16 fps, 128 frames, 8.0 seconds.
 * Camera export of this take is Backbone `convention: "opencv_c2w"` (`frames[].c2w`).
 * The take id `cam-take-01` is an opaque string. This module does not mint `cam_<ULID>`.
 */
export const PHASE0_STAMP = "2026-11-12T00:00:00.000Z";
export const PHASE0_SHOT_ID = "shot-handshake-cup";
export const PHASE0_WORLD_ID = "world-apartment-livingroom";
export const PHASE0_FPS = 16;
export const PHASE0_DURATION_FRAMES = 128;

type Phase0ContactEnd = { actor: string; part?: RigPart };

/**
 * Demo contact graph from #30. `a` is the cue actor, `b` is the other end.
 * A contact scope is `{ kind: "contact", contact_id }`. Actor ids are read from `a` / `b`.
 * This list is not stored on `SceneState`.
 */
export const PHASE0_CONTACT_GRAPH: readonly {
  contact_id: string;
  a: Phase0ContactEnd;
  b: Phase0ContactEnd;
}[] = [
  {
    contact_id: "handshake_01",
    a: { actor: "actor-a", part: "right_hand" },
    b: { actor: "actor-b", part: "right_hand" },
  },
  {
    contact_id: "cup_hold_01",
    a: { actor: "actor-a", part: "left_hand" },
    b: { actor: "object-cup" },
  },
  {
    contact_id: "cup_place_01",
    a: { actor: "object-cup" },
    b: { actor: "object-table" },
  },
];

/** Scope key for one contact. Actors are not on the scope; they come from `a` / `b`. */
export const phase0ContactScope = (contact_id: string) => ({ kind: "contact" as const, contact_id });

const phase0Contact = (contact_id: string) => {
  const contact = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === contact_id);
  if (!contact) throw new Error(`Missing contact ${contact_id}.`);
  return contact;
};

const IDENTITY_EULER: Vec3 = [0, 0, 0];
const UNIT_SCALE: Vec3 = [1, 1, 1];
const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

const add = (left: Vec3, right: Vec3): Vec3 => [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const sub = (left: Vec3, right: Vec3): Vec3 => [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
const scale = (value: Vec3, factor: number): Vec3 => [value[0] * factor, value[1] * factor, value[2] * factor];
const length = (value: Vec3) => Math.hypot(value[0], value[1], value[2]);

/**
 * Table rest from the Phase 0 demo. Y is up, so `0.72` is the tabletop height.
 * The cup's placed origin is this same point.
 */
export const PHASE0_TABLE_POSITION: Vec3 = [1.25, 0.72, 0.1];

/** Wrist-to-cup offset in the `left_hand` frame. This is not a world position. */
export const PHASE0_CUP_IN_HAND_OFFSET: Vec3 = [0.03, 0.02, 0.05];

/** Stub reach from actor A's left shoulder to `left_hand`. */
export const PHASE0_STUB_ARM_LENGTH_M = 0.53;

/** Left shoulder in actor A's root frame, identity rotation. */
export const PHASE0_LEFT_SHOULDER_IN_ROOT: Vec3 = [-0.18, 0.4, 0.02];

/**
 * Root moved off the origin so the 0.53 m stub arm reaches the cup on the table at frame 48.
 * B stays 1 m to +X, which puts the table between the two roots.
 */
export const PHASE0_ACTOR_A_ROOT: Vec3 = [1.001, 0.38, -0.309];
export const PHASE0_ACTOR_B_ROOT: Vec3 = [2.001, 0.38, -0.309];

const shoulderWorld = (): Vec3 => add(PHASE0_ACTOR_A_ROOT, PHASE0_LEFT_SHOULDER_IN_ROOT);

const handOnTable = (): Vec3 => sub(PHASE0_TABLE_POSITION, PHASE0_CUP_IN_HAND_OFFSET);

const handAtStart = (): Vec3 => {
  const towardChest: Vec3 = [-0.08, -0.16, 0.22];
  return add(shoulderWorld(), scale(towardChest, 0.28 / length(towardChest)));
};

/**
 * Actor A's `left_hand` world pose while the cup is in that hand.
 * Frame 48 is the release: the wrist is on the tabletop cup, still inside the stub arm.
 * Root translation stays at `PHASE0_ACTOR_A_ROOT`; only the arm reaches.
 */
export const phase0LeftHandWorldPose = (frame: number): { translation: Vec3; rotation: Quat } => {
  const amount = Math.min(1, Math.max(0, frame / 48));
  const start = handAtStart();
  const end = handOnTable();
  return {
    translation: add(start, scale(sub(end, start), amount)),
    rotation: IDENTITY_QUAT,
  };
};

const cupPosition = (frame: number): Vec3 => {
  if (frame >= 48) return PHASE0_TABLE_POSITION;
  return add(phase0LeftHandWorldPose(frame).translation, PHASE0_CUP_IN_HAND_OFFSET);
};

/** Dense `T_world_obj` for the cup. Authority for evaluation; the shot stores the bake. */
export const phase0CupDenseFrames = (): DenseObjectFrame[] =>
  Array.from({ length: PHASE0_DURATION_FRAMES }, (_, frame) => ({
    t: frame,
    T_world_obj: worldMatrixFromShotPose({
      position: cupPosition(frame),
      rotationEuler: IDENTITY_EULER,
      scale: UNIT_SCALE,
    }),
  }));

const pin = (assetId: string, revisionId: string) => ({ assetId, revisionId });

const revision = (assetId: string, revisionId: string, uri: string, createdAt: string): AssetRevision => ({
  revisionId,
  assetId,
  revision: 1,
  contentHash: `legacy-fingerprint:${assetId}:1:${uri}`,
  uri,
  sourceAxes: sourceAxesFromWorldAsset({
    coordinateSystem: "Y_UP",
    unitScaleMeters: 1,
    handedness: "right",
    frontAxis: "+Z",
  }),
  createdAt,
  ...(assetId.startsWith("ast_phase0_a") || assetId.startsWith("ast_phase0_b")
    ? { rig: { skeleton: "smplx" as const, partMap: { ...SMPLX_PART_JOINT } } }
    : {}),
});

const asset = (id: string, revisionId: string, kind: Asset["kind"], name: string): Asset => ({
  id,
  kind,
  name,
  aliases: [],
  localizedNames: {},
  headRevisionId: revisionId,
  revisionIds: [revisionId],
});

export const phase0World = (): WorldAsset => normalizeWorldAsset({
  id: PHASE0_WORLD_ID,
  name: "Apartment Livingroom",
  description: "Phase 0 room. Mesh set, Y-up meters, facing +Z.",
  representation: "mesh",
  coordinateSystem: "Y_UP",
  handedness: "right",
  frontAxis: "+Z",
  unitScaleMeters: 1,
  rootUri: "worlds/apartment_livingroom",
  surfaceMeshPath: "worlds/apartment_livingroom/room.glb",
  previewPath: "worlds/apartment_livingroom/preview.glb",
  usdPath: "worlds/apartment_livingroom/world.usda",
  createdAt: PHASE0_STAMP,
  updatedAt: PHASE0_STAMP,
  version: 1,
  elements: [],
  props: [],
  semanticTags: ["interior", "phase0"],
});

const betas = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Room set plus A, B, the table, and the cup. The cup's first parent is actor A. */
export const phase0Scene = (): SceneState => {
  const world = phase0World();
  const base = migrateWorldToSceneState(world);
  const aUri = "meshes/phase0/actor-a.glb";
  const bUri = "meshes/phase0/actor-b.glb";
  const cupUri = "meshes/phase0/cup.glb";
  const tableUri = "meshes/phase0/table.glb";
  const aAsset = "ast_phase0_a";
  const aRev = "rev_phase0_a_v1";
  const bAsset = "ast_phase0_b";
  const bRev = "rev_phase0_b_v1";
  const cupAsset = "ast_phase0_cup";
  const cupRev = "rev_phase0_cup_v1";
  const tableAsset = "ast_phase0_table";
  const tableRev = "rev_phase0_table_v1";
  return sceneStateSchema.parse({
    ...base,
    assets: {
      ...base.assets,
      [aAsset]: asset(aAsset, aRev, "character", "A"),
      [bAsset]: asset(bAsset, bRev, "character", "B"),
      [cupAsset]: asset(cupAsset, cupRev, "prop", "컵"),
      [tableAsset]: asset(tableAsset, tableRev, "prop", "테이블"),
    },
    revisions: {
      ...base.revisions,
      [aRev]: revision(aAsset, aRev, aUri, PHASE0_STAMP),
      [bRev]: revision(bAsset, bRev, bUri, PHASE0_STAMP),
      [cupRev]: revision(cupAsset, cupRev, cupUri, PHASE0_STAMP),
      [tableRev]: revision(tableAsset, tableRev, tableUri, PHASE0_STAMP),
    },
    actors: {
      "actor-a": {
        id: "actor-a",
        type: "actor",
        label: "A",
        aliases: [],
        localizedNames: {},
        assetRef: pin(aAsset, aRev),
        restTransform: { translation: PHASE0_ACTOR_A_ROOT, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        legacyRefs: [{ kind: "shot_subject", shotId: PHASE0_SHOT_ID, subjectId: "actor-a" }],
        skeleton: { model: "smplx", gender: "neutral", betas },
      },
      "actor-b": {
        id: "actor-b",
        type: "actor",
        label: "B",
        aliases: [],
        localizedNames: {},
        assetRef: pin(bAsset, bRev),
        restTransform: { translation: PHASE0_ACTOR_B_ROOT, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        legacyRefs: [{ kind: "shot_subject", shotId: PHASE0_SHOT_ID, subjectId: "actor-b" }],
        skeleton: { model: "smplx", gender: "neutral", betas },
      },
    },
    objects: {
      "object-table": {
        id: "object-table",
        type: "object",
        role: "set_piece",
        label: "테이블",
        aliases: [],
        localizedNames: {},
        assetRef: pin(tableAsset, tableRev),
        restTransform: { translation: PHASE0_TABLE_POSITION, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        legacyRefs: [],
        motionMode: "static",
        attachments: [],
      },
      "object-cup": {
        id: "object-cup",
        type: "object",
        role: "prop",
        label: "컵",
        aliases: [],
        localizedNames: {},
        assetRef: pin(cupAsset, cupRev),
        restTransform: { translation: cupPosition(0), rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        legacyRefs: [{ kind: "shot_subject", shotId: PHASE0_SHOT_ID, subjectId: "object-cup" }],
        motionMode: "dynamic",
        attachments: (() => {
          const hold = phase0Contact("cup_hold_01");
          const place = phase0Contact("cup_place_01");
          if (!hold.a.part) throw new Error("cup_hold_01 is missing a hand.");
          return [
            {
              parentInstanceId: hold.a.actor,
              rigPart: hold.a.part,
              offset: { translation: PHASE0_CUP_IN_HAND_OFFSET, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              frameRange: [0, 48] as [number, number],
              sourceContactId: hold.contact_id,
            },
            {
              parentInstanceId: place.b.actor,
              offset: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              frameRange: [48, 128] as [number, number],
              sourceContactId: place.contact_id,
            },
          ];
        })(),
      },
    },
  });
};

const placement = (position: Vec3) => ({
  position,
  rotationEuler: IDENTITY_EULER,
  scale: UNIT_SCALE,
});

/** 2 actors, 1 prop, 1 room, 1 camera take. 16 fps, 128 frames. */
export const phase0Shot = (): Shot => {
  const clock = { fps: PHASE0_FPS, durationFrames: PHASE0_DURATION_FRAMES, origin: "clip_local" as const };
  const cupMotion = bakeDenseObjectMotion({ time: clock }, phase0CupDenseFrames());
  const actor = (id: string, assetId: string, revisionId: string, uri: string, position: Vec3) => linkPosedSubject(PHASE0_SHOT_ID, {
    id: subjectId(id),
    instanceId: id,
    assetId: assetId as Shot["subjects"][number]["assetId"],
    assetVersion: 1,
    assetRef: pin(assetId, revisionId),
    name: id === "actor-a" ? "A" : "B",
    uri,
    placement: placement(position),
    visible: true,
    locked: false,
    kind: "human",
    representation: "mesh",
    motion: { channel: "unset" },
  });
  const yaw = eulerToQuaternion([0, 0.15, 0]);
  return parseShot({
    schemaVersion: 1,
    id: shotId(PHASE0_SHOT_ID),
    name: "Handshake cup",
    time: clock,
    subjects: [
      actor("actor-a", "ast_phase0_a", "rev_phase0_a_v1", "meshes/phase0/actor-a.glb", PHASE0_ACTOR_A_ROOT),
      actor("actor-b", "ast_phase0_b", "rev_phase0_b_v1", "meshes/phase0/actor-b.glb", PHASE0_ACTOR_B_ROOT),
      linkPosedSubject(PHASE0_SHOT_ID, {
        id: subjectId("object-cup"),
        instanceId: "object-cup",
        assetId: "ast_phase0_cup" as Shot["subjects"][number]["assetId"],
        assetVersion: 1,
        assetRef: pin("ast_phase0_cup", "rev_phase0_cup_v1"),
        name: "컵",
        uri: "meshes/phase0/cup.glb",
        placement: placement(cupPosition(0)),
        visible: true,
        locked: false,
        kind: "object",
        representation: "mesh",
        motion: cupMotion,
      }),
    ],
    camera: {
      status: "ready",
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
      interpolation: "linear",
      selectedTakeId: takeId("cam-take-01"),
      takes: [{
        schemaVersion: 1,
        id: takeId("cam-take-01"),
        name: "Phone",
        source: "record",
        createdAt: PHASE0_STAMP,
        keys: [
          { frame: 0, position: [0.2, 1.5, 3.2], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
          { frame: 96, position: [0.4, 1.45, 2.8], rotation: yaw, focalLengthMm: 35 },
        ],
      }],
    },
    environment: { worldId: PHASE0_WORLD_ID },
    renders: [],
  });
};

/** Speech motion stays `generated`. The handshake cue points at `handshake_01`. */
export const phase0PerformancePlan = (): PerformancePlanParams => {
  const handshake = phase0Contact("handshake_01");
  return performancePlanFromNode({
  sources: [{
    id: "speech-motion-01",
    type: "generated",
    label: "speech-to-motion",
    uri: "backbone://pose/shot-handshake-cup",
    enabled: true,
    notes: "컵은 여기 둘게.",
    qualityGate: { status: "unreviewed", contactConfidence: 1 },
  }],
  cues: [
    {
      id: "line-a",
      kind: "dialogue",
      label: "Line",
      direction: "컵은 여기 둘게.",
      startFrame: 8,
      endFrame: 40,
      actorId: "actor-a",
      sourceId: "speech-motion-01",
    },
    {
      id: "handshake",
      kind: "action",
      label: "Handshake",
      direction: "A and B shake right hands.",
      startFrame: 72,
      endFrame: 112,
      actorId: handshake.a.actor,
      targetActorId: handshake.b.actor,
      rigPart: handshake.a.part,
      targetRigPart: handshake.b.part,
      contactId: handshake.contact_id,
      sourceId: "speech-motion-01",
    },
  ],
  audioGuide: {
    label: "A",
    offsetFrame: 8,
    durationFrames: 32,
    transcript: "컵은 여기 둘게.",
  },
});
};

/** Opt-in project. The editor boot project is unchanged. */
export const phase0Project = (): Project => {
  const world = phase0World();
  const shot = phase0Shot();
  const scene = phase0Scene();
  return {
    id: "project-phase0",
    name: "Phase 0",
    createdAt: PHASE0_STAMP,
    updatedAt: PHASE0_STAMP,
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: {
      seq: { id: "seq", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, PHASE0_DURATION_FRAMES] },
    },
    clips: {
      [shot.id]: {
        id: shot.id,
        name: shot.name,
        start: 0,
        end: PHASE0_DURATION_FRAMES,
        duration: PHASE0_DURATION_FRAMES,
        durationFrames: PHASE0_DURATION_FRAMES,
        sourceType: "empty",
        clipGraphId: "graph",
        cacheStatus: "valid",
        linkedWorldId: world.id,
      },
    },
    shots: { [shot.id]: shot },
    clipGraphs: {
      graph: { id: "graph", clipId: shot.id, rootNodeId: "root", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] },
    },
    nodes: {},
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: { [world.id]: world },
    sceneStates: { [world.id]: scene },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};
