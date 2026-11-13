import { describe, expect, it } from "vitest";
import { IDENTITY_TRANSFORM, sourceAxesFromWorldAsset, type SourceAxes } from "./coordinates";
import { createPersistentIdFactory, type PersistentIdFactory } from "./ids";
import {
  createPreservationCheck,
  temporaryCanonicalize,
  temporaryPreservationCheck,
  temporaryPreservationHasher,
  type PreservationReport,
  type ShotStateReader,
  type StateSelector,
} from "./preservation";
import {
  cloneInstance,
  sceneStateSchema,
  SMPLX_PART_JOINT,
  type AssetRevision,
  type SceneState,
} from "./sceneState";

const CREATED_AT = "2026-11-04T00:00:00.000Z";

const axes: SourceAxes = sourceAxesFromWorldAsset({
  coordinateSystem: "Y_UP",
  unitScaleMeters: 1,
  handedness: "right",
  frontAxis: "+Z",
});

const factory = (): PersistentIdFactory => {
  let tick = 0;
  return createPersistentIdFactory({
    now: () => 1_700_000_000_000,
    randomBytes: () => {
      const bytes = new Uint8Array(10);
      bytes[9] = tick;
      tick += 1;
      return bytes;
    },
  });
};

const revision = (assetId: string, revisionId: string, uri: string): AssetRevision => ({
  revisionId,
  assetId,
  revision: 1,
  contentHash: `legacy-fingerprint:${revisionId}`,
  uri,
  sourceAxes: axes,
  createdAt: CREATED_AT,
});

const handshakeScene = () => {
  const ids = factory();
  const actorA = ids.mint("act");
  const actorB = ids.mint("act");
  const table = ids.mint("obj");
  const cup = ids.mint("obj");
  const setAsset = ids.mint("ast");
  const setRevision = ids.mint("rev");
  const characterA = ids.mint("ast");
  const characterARevision = ids.mint("rev");
  const characterB = ids.mint("ast");
  const characterBRevision = ids.mint("rev");
  const tableAsset = ids.mint("ast");
  const tableRevision = ids.mint("rev");
  const cupAsset = ids.mint("ast");
  const cupRevision = ids.mint("rev");
  const cameraTrackId = ids.mint("cam");
  const asset = (id: string, revisionId: string, kind: "world" | "character" | "prop" | "set", name: string) => ({
    id,
    kind,
    name,
    aliases: [],
    localizedNames: {},
    headRevisionId: revisionId,
    revisionIds: [revisionId],
  });
  const skeleton = { model: "smplx" as const, gender: "neutral" as const, betas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const scene = sceneStateSchema.parse({
    schemaVersion: 1,
    contract: {
      handedness: "right",
      upAxis: "Y",
      forwardAxis: "+Z",
      unit: "meter",
      metersPerUnit: 1,
      cameraLocalFrame: "gl",
      exportCameraFrame: "opencv",
      rotationStorage: "quaternion_xyzw",
      matrixLayout: "row_major_nested",
      timeBase: "shot_local_frame",
    },
    worldId: "world-apartment-livingroom",
    setAssetRef: { assetId: setAsset, revisionId: setRevision },
    assets: {
      [setAsset]: asset(setAsset, setRevision, "set", "Apartment"),
      [characterA]: asset(characterA, characterARevision, "character", "A"),
      [characterB]: asset(characterB, characterBRevision, "character", "B"),
      [tableAsset]: asset(tableAsset, tableRevision, "prop", "Table"),
      [cupAsset]: asset(cupAsset, cupRevision, "prop", "Cup"),
    },
    revisions: {
      [setRevision]: revision(setAsset, setRevision, "worlds/apartment_livingroom"),
      [characterARevision]: revision(characterA, characterARevision, "placeholder://smplx/a"),
      [characterBRevision]: revision(characterB, characterBRevision, "placeholder://smplx/b"),
      [tableRevision]: revision(tableAsset, tableRevision, "placeholder://prop/table"),
      [cupRevision]: revision(cupAsset, cupRevision, "placeholder://prop/cup"),
    },
    actors: {
      [actorA]: {
        id: actorA,
        type: "actor",
        label: "A",
        assetRef: { assetId: characterA, revisionId: characterARevision },
        restTransform: IDENTITY_TRANSFORM,
        skeleton,
      },
      [actorB]: {
        id: actorB,
        type: "actor",
        label: "B",
        assetRef: { assetId: characterB, revisionId: characterBRevision },
        restTransform: { ...IDENTITY_TRANSFORM, translation: [1, 0, 0] },
        skeleton,
      },
    },
    objects: {
      [table]: {
        id: table,
        type: "object",
        role: "set_piece",
        label: "테이블",
        assetRef: { assetId: tableAsset, revisionId: tableRevision },
        restTransform: { ...IDENTITY_TRANSFORM, translation: [0.4, 0, 0.2] },
        motionMode: "static",
      },
      [cup]: {
        id: cup,
        type: "object",
        role: "prop",
        label: "컵",
        assetRef: { assetId: cupAsset, revisionId: cupRevision },
        restTransform: IDENTITY_TRANSFORM,
        motionMode: "keyframed",
        attachments: [
          {
            parentInstanceId: actorB,
            rigPart: "left_hand",
            offset: IDENTITY_TRANSFORM,
            frameRange: [0, 40],
            sourceContactId: "cup_hold_01",
          },
          {
            parentInstanceId: table,
            offset: IDENTITY_TRANSFORM,
            frameRange: [40, 81],
            sourceContactId: "cup_place_01",
          },
        ],
      },
    },
  });
  return { scene, actorA, actorB, table, cup, cameraTrackId };
};

const rootFrames = (x: number) => [
  { t: 0, transl: [x, 0, 0], global_orient: [0, 0, 0], body_pose: [1] },
  { t: 1, transl: [x, 0, 1], global_orient: [0, 0.2, 0], body_pose: [1] },
];

const cameraSamples = [
  { frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], deviceTimestampNs: 0 },
];

const read = (
  scene: SceneState,
  ids: { actorA: string; actorB: string },
  hand: "left_hand" | "right_hand",
  driftA = 0,
): ShotStateReader => ({
  scene,
  cameraSamples: () => cameraSamples,
  actorPoseFrames: (actorId) => {
    if (actorId === ids.actorA) return rootFrames(driftA);
    if (actorId === ids.actorB) {
      return rootFrames(1).map((frame) => ({ ...frame, hand_pose: [hand] }));
    }
    return [];
  },
  contact: (contactId) =>
    contactId === "handshake_01"
      ? { contactId, actorId: ids.actorB, effector: hand, joint: SMPLX_PART_JOINT[hand] }
      : undefined,
});

const recomputeOf = (actorB: string): StateSelector[] => [
  { kind: "actor_motion", actorId: actorB },
  { kind: "contact", contactId: "handshake_01" },
];

const expectReport = (report: PreservationReport, ok: boolean) => {
  for (const row of report) {
    expect(row.ok, `${row.selector.kind}:${row.expect}`).toBe(ok);
  }
};

describe("phase 1 preservation", () => {
  it("quantizes numbers and sorts keys", () => {
    expect(temporaryCanonicalize({ b: 1, a: { d: 2, c: 1.0000004 } })).toBe('{"a":{"c":1,"d":2},"b":1}');
  });

  it("keeps instance ids, camera, set layout, and A root motion when only B's handshake hand changes", () => {
    const { scene, actorA, actorB, cup, cameraTrackId } = handshakeScene();
    const before = read(scene, { actorA, actorB }, "left_hand");
    const after = read(scene, { actorA, actorB }, "right_hand");
    const preserveSelectors: StateSelector[] = [
      { kind: "camera_track", cameraTrackId },
      { kind: "actor_root_motion", actorId: actorA },
      { kind: "set_layout" },
    ];
    const report = temporaryPreservationCheck.check(before, after, preserveSelectors, recomputeOf(actorB));
    expectReport(report, true);
    expect(report.map((row) => row.selector.kind)).toEqual([
      "camera_track",
      "actor_root_motion",
      "set_layout",
      "instance_identity",
      "actor_motion",
      "contact",
    ]);
    expect(Object.keys(before.scene.actors).sort()).toEqual(Object.keys(after.scene.actors).sort());
    expect(Object.keys(before.scene.objects).sort()).toEqual(Object.keys(after.scene.objects).sort());
    expect(after.scene.objects[cup]?.attachments[0]?.rigPart).toBe("left_hand");
    expect(after.scene.objects[cup]?.attachments[1]?.parentInstanceId).toBe(
      before.scene.objects[cup]?.attachments[1]?.parentInstanceId,
    );
    expect(after.scene.setAssetRef).toEqual(before.scene.setAssetRef);
  });

  it("fails when A root motion drifts or an instance id is reissued", () => {
    const fixture = handshakeScene();
    const before = read(fixture.scene, fixture, "left_hand");
    const drifted = read(fixture.scene, fixture, "right_hand", 0.001);
    const preserveSelectors: StateSelector[] = [
      { kind: "camera_track", cameraTrackId: fixture.cameraTrackId },
      { kind: "actor_root_motion", actorId: fixture.actorA },
      { kind: "set_layout" },
    ];
    const driftedReport = temporaryPreservationCheck.check(before, drifted, preserveSelectors, recomputeOf(fixture.actorB));
    expect(driftedReport.find((row) => row.selector.kind === "actor_root_motion")?.ok).toBe(false);
    expect(driftedReport.find((row) => row.selector.kind === "set_layout")?.ok).toBe(true);
    expect(driftedReport.find((row) => row.selector.kind === "instance_identity")?.ok).toBe(true);

    const ids = createPersistentIdFactory({
      now: () => 1_800_000_000_000,
      randomBytes: () => new Uint8Array(10),
    });
    const cloneId = ids.mint("obj");
    const cloned = cloneInstance(fixture.scene, fixture.cup, cloneId, "컵 복제");
    expect(cloned.objects[cloneId]?.clonedFrom).toBe(fixture.cup);
    expect(cloned.objects[cloneId]?.attachments).toEqual([]);
    expect(cloned.objects[fixture.cup]?.attachments).toHaveLength(2);
    const reissued = temporaryPreservationCheck.check(before, read(cloned, fixture, "left_hand"), [], []);
    expect(reissued.find((row) => row.selector.kind === "instance_identity")?.ok).toBe(false);
  });

  it("uses the hasher passed through the preservation interface", () => {
    const fixture = handshakeScene();
    const seen: unknown[] = [];
    const check = createPreservationCheck({
      hash(value) {
        seen.push(value);
        return temporaryPreservationHasher.hash(value);
      },
    });
    const before = read(fixture.scene, fixture, "left_hand");
    const after = read(fixture.scene, fixture, "right_hand");
    const report = check.check(
      before,
      after,
      [{ kind: "actor_root_motion", actorId: fixture.actorA }],
      [{ kind: "contact", contactId: "handshake_01" }],
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(report.every((row) => row.ok)).toBe(true);
  });
});
