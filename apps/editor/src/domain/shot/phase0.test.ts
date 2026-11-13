import { describe, expect, it } from "vitest";
import { performancePlanFromNode } from "../performance/plan";
import { projectWithShots } from "../project/migrateToShot";
import { targetResolverForProject } from "../project/sceneLink";
import type { Project } from "../project/types";
import { deserializeProject, serializeProject } from "../../infrastructure/persistence/serializeProject";
import { applyImportTransform, shotFps, type Mat4 } from "../worlds/coordinates";
import { createPersistentIdFactory } from "../worlds/ids";
import { cloneInstance, renameInstance } from "../worlds/sceneState";
import { SHOT_EULER_ORDER, eulerToQuaternion, quaternionToEuler } from "./eulerAdapter";
import {
  clonePosedSubject,
  legacyShotInstanceId,
  linkShotSubjects,
  persistentAssetIdForLegacy,
  renamePosedSubject,
  revisionIdForAssetVersion,
} from "./instanceLink";
import { bakeDenseObjectMotion, shotPoseFromWorldMatrix, worldMatrixFromShotPose } from "./motionBake";
import { environmentImportTransform, prepareModelInput } from "./modelInput";
import {
  PHASE0_ACTOR_A_ROOT,
  PHASE0_ACTOR_B_ROOT,
  PHASE0_CUP_IN_HAND_OFFSET,
  PHASE0_DURATION_FRAMES,
  PHASE0_FPS,
  PHASE0_LEFT_SHOULDER_IN_ROOT,
  PHASE0_STUB_ARM_LENGTH_M,
  PHASE0_CONTACT_GRAPH,
  PHASE0_TABLE_POSITION,
  phase0ContactScope,
  phase0CupDenseFrames,
  phase0LeftHandWorldPose,
  phase0PerformancePlan,
  phase0Project,
  phase0Scene,
  phase0Shot,
} from "./phase0Sample";
import { parseShot } from "./schema";
import type { PosedSubject, Shot } from "./types";

const posed = (shot: Shot): PosedSubject[] =>
  shot.subjects.filter((subject): subject is PosedSubject => subject.kind !== "light");

describe("phase 0 fixture", () => {
  it("matches the demo clock, cast, and cup parent", () => {
    const shot = phase0Shot();
    const scene = phase0Scene();
    expect(SHOT_EULER_ORDER).toBe("XYZ");
    expect(shotFps(shot)).toBe(PHASE0_FPS);
    expect(shot.time).toEqual({ fps: 16, durationFrames: 128, origin: "clip_local" });
    expect(shot.time.durationFrames / shot.time.fps).toBe(8);
    expect(shot.subjects.map((subject) => subject.id)).toEqual(["actor-a", "actor-b", "object-cup"]);
    expect(posed(shot).map((subject) => subject.instanceId)).toEqual(["actor-a", "actor-b", "object-cup"]);
    expect(scene.actors["actor-a"]?.label).toBe("A");
    expect(scene.actors["actor-b"]?.label).toBe("B");
    expect(scene.objects["object-table"]?.role).toBe("set_piece");
    expect(scene.objects["object-cup"]?.motionMode).toBe("dynamic");
    expect(scene.objects["object-cup"]?.attachments[0]).toMatchObject({
      parentInstanceId: "actor-a",
      rigPart: "left_hand",
      sourceContactId: "cup_hold_01",
      frameRange: [0, 48],
    });
    expect(scene.objects["object-cup"]?.attachments[1]?.rigPart).toBeUndefined();
    expect(scene.objects["object-cup"]?.attachments[1]?.parentInstanceId).toBe("object-table");
    expect(shot.camera.status === "ready" && shot.camera.selectedTakeId).toBe("cam-take-01");
    expect(shot.coordinateContract?.exportCameraFrame).toBe("opencv");
  });

  it("round-trips instance ids, pins, transforms, the take, and the clock", () => {
    const project = projectWithShots(phase0Project());
    const raw = serializeProject(project);
    const loaded = projectWithShots(deserializeProject(raw));
    const before = project.shots?.["shot-handshake-cup"];
    const after = loaded.shots?.["shot-handshake-cup"];
    expect(after?.time).toEqual(before?.time);
    expect(after?.camera).toEqual(before?.camera);
    expect(posed(after!).map((subject) => ({
      id: subject.instanceId,
      pin: subject.assetRef,
      placement: subject.placement,
    }))).toEqual(posed(before!).map((subject) => ({
      id: subject.instanceId,
      pin: subject.assetRef,
      placement: subject.placement,
    })));
    const cup = loaded.sceneStates?.["world-apartment-livingroom"]?.objects["object-cup"];
    expect(cup?.attachments[0]?.parentInstanceId).toBe("actor-a");
    expect(cup?.motionMode).toBe("dynamic");
    expect(shotFps(after!)).toBe(16);
    expect(PHASE0_DURATION_FRAMES).toBe(128);
  });

  it("resolves a subject instance id from the loaded scene", () => {
    const project = projectWithShots(phase0Project());
    const match = targetResolverForProject(project)
      .resolve("A", { selectionIds: [], locale: "en" })
      .find((item) => item.instanceId === "actor-a");
    expect(match?.instanceId).toBe(project.shots?.["shot-handshake-cup"]?.subjects[0] && posed(project.shots["shot-handshake-cup"])[0]?.instanceId);
  });

  it("keeps the instance id on rename and mints a new one on clone", () => {
    const shot = phase0Shot();
    const actor = posed(shot)[0]!;
    const renamed = renamePosedSubject(actor, "A renamed");
    expect(renamed.id).toBe(actor.id);
    expect(renamed.instanceId).toBe(actor.instanceId);
    const ids = createPersistentIdFactory({ now: () => 10, randomBytes: () => new Uint8Array(10).fill(4) });
    ids.reserve(actor.instanceId ?? "");
    const cloned = clonePosedSubject(actor, shot.id, ids, "A copy");
    expect(cloned.instanceId).not.toBe(actor.instanceId);
    expect(cloned.id).not.toBe(actor.id);
    expect(cloned.assetRef).toEqual(actor.assetRef);
    expect(cloned.clonedFrom).toBe(actor.instanceId);

    const scene = phase0Scene();
    const renamedScene = renameInstance(scene, "actor-a", { label: "A renamed" });
    expect(renamedScene.actors["actor-a"]?.id).toBe("actor-a");
    const minted = createPersistentIdFactory({
      now: () => 11,
      randomBytes: () => new Uint8Array(10).fill(5),
      reserved: ["actor-a"],
    }).mint("act");
    const clonedScene = cloneInstance(renamedScene, "actor-a", minted, "A copy");
    expect(clonedScene.actors[minted]?.clonedFrom).toBe("actor-a");
    expect(clonedScene.actors["actor-a"]?.id).toBe("actor-a");
  });

  it("bakes the cup to the corner keys and stores euler", () => {
    const shot = phase0Shot();
    const clock = { time: shot.time };
    const baked = bakeDenseObjectMotion(clock, phase0CupDenseFrames());
    expect(baked.channel).toBe("explicit");
    if (baked.channel !== "explicit") return;
    expect(baked.keys.map((key) => key.frame)).toEqual([0, 48, 127]);
    expect(baked.keys[0]?.rotationEuler).toEqual([0, 0, 0]);
    expect(baked.keys[0]?.position[0]).toBeCloseTo(phase0CupDenseFrames()[0]!.T_world_obj[0][3], 6);
    const again = bakeDenseObjectMotion(clock, phase0CupDenseFrames());
    expect(again).toEqual(baked);
    expect("fps" in baked).toBe(false);

    const bumped = phase0CupDenseFrames().map((frame) => frame.t === 24
      ? {
          ...frame,
          T_world_obj: worldMatrixFromShotPose({
            position: [frame.T_world_obj[0][3] + 0.02, frame.T_world_obj[1][3], frame.T_world_obj[2][3]],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
          }),
        }
      : frame);
    const withCorner = bakeDenseObjectMotion(clock, bumped);
    expect(withCorner.channel === "explicit" && withCorner.keys.some((key) => key.frame === 24)).toBe(true);

    const skipped = bakeDenseObjectMotion(clock, [
      ...phase0CupDenseFrames(),
      { t: 10.5, T_world_obj: phase0CupDenseFrames()[0]!.T_world_obj },
      { t: 128, T_world_obj: phase0CupDenseFrames()[0]!.T_world_obj },
    ]);
    expect(skipped).toEqual(baked);
    expect(() => bakeDenseObjectMotion({ time: { fps: 0, durationFrames: 128 } }, phase0CupDenseFrames())).toThrow(/fps/);
  });

  it("converts a Z-up world at the model boundary and leaves the shot euler in place", () => {
    const shot = phase0Shot();
    const prepared = prepareModelInput(shot, {
      worldId: shot.environment?.worldId ?? "world",
      representation: "mesh",
      geometryUri: "room.glb",
      coordinateSystem: "Z_UP",
      unitScaleMeters: 1,
    }, "16:9");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.input.coordinateContract.upAxis).toBe("Y");
    expect(prepared.input.coordinateContract.rotationStorage).toBe("quaternion_xyzw");
    expect(prepared.input.coordinateContract.exportCameraFrame).toBe("opencv");
    const transform = prepared.input.environment?.importTransform;
    expect(transform).toBeDefined();
    expect(applyImportTransform(transform!, [0, 0, 1])[1]).toBeCloseTo(1, 6);
    expect(prepared.input.subjects[0]?.placement.rotationEuler).toEqual(shot.subjects[0]?.placement.rotationEuler);
    expect(prepared.input.subjects[0]?.canonicalPlacement.rotation).toEqual(
      eulerToQuaternion(shot.subjects[0]!.placement.rotationEuler),
    );
    expect(environmentImportTransform({ coordinateSystem: "Y_UP", unitScaleMeters: 1 })).toBeUndefined();
  });

  it("composes the cup from the hand-local offset and reaches the tabletop", () => {
    const scene = phase0Scene();
    const shot = phase0Shot();
    const cup = scene.objects["object-cup"];
    const table = scene.objects["object-table"];
    const hold = cup?.attachments[0];
    const placed = cup?.attachments[1];
    expect(table?.restTransform.translation).toEqual([...PHASE0_TABLE_POSITION]);
    expect(scene.actors["actor-a"]?.restTransform.translation).toEqual([...PHASE0_ACTOR_A_ROOT]);
    expect(scene.actors["actor-b"]?.restTransform.translation).toEqual([...PHASE0_ACTOR_B_ROOT]);
    expect(shot.subjects[0]?.placement.position).toEqual(PHASE0_ACTOR_A_ROOT);
    expect(shot.subjects[1]?.placement.position).toEqual(PHASE0_ACTOR_B_ROOT);
    expect(PHASE0_ACTOR_A_ROOT[0]).toBeLessThan(PHASE0_TABLE_POSITION[0]);
    expect(PHASE0_TABLE_POSITION[0]).toBeLessThan(PHASE0_ACTOR_B_ROOT[0]);
    expect(hold?.offset.translation).toEqual([...PHASE0_CUP_IN_HAND_OFFSET]);
    const start = phase0CupDenseFrames()[0]!.T_world_obj;
    expect(hold?.offset.translation).not.toEqual([start[0][3], start[1][3], start[2][3]]);

    const multiply = (parent: Mat4, local: Mat4): Mat4 => ([0, 1, 2, 3] as const).map((row) =>
      ([0, 1, 2, 3] as const).map((column) =>
        parent[row][0] * local[0][column]
        + parent[row][1] * local[1][column]
        + parent[row][2] * local[2][column]
        + parent[row][3] * local[3][column]),
    ) as Mat4;

    const quatAngle = (left: readonly number[], right: readonly number[]) => {
      const dot = Math.abs(left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]! + left[3]! * right[3]!);
      return 2 * Math.acos(Math.min(1, dot));
    };

    for (const frame of phase0CupDenseFrames()) {
      const holding = frame.t < 48;
      const parentTranslation = holding
        ? phase0LeftHandWorldPose(frame.t).translation
        : table!.restTransform.translation;
      const offset = holding ? hold!.offset : placed!.offset;
      const composed = multiply(
        worldMatrixFromShotPose({ position: [...parentTranslation], rotationEuler: [0, 0, 0], scale: [1, 1, 1] }),
        worldMatrixFromShotPose({
          position: [...offset.translation],
          rotationEuler: quaternionToEuler([...offset.rotation]),
          scale: [...offset.scale],
        }),
      );
      const expected = shotPoseFromWorldMatrix(frame.T_world_obj);
      const actual = shotPoseFromWorldMatrix(composed);
      const gap = Math.hypot(
        actual.position[0] - expected.position[0],
        actual.position[1] - expected.position[1],
        actual.position[2] - expected.position[2],
      );
      expect(gap).toBeLessThanOrEqual(0.005);
      expect(quatAngle(eulerToQuaternion(actual.rotationEuler), eulerToQuaternion(expected.rotationEuler)))
        .toBeLessThanOrEqual((2 * Math.PI) / 180);
    }

    const shoulder = [
      PHASE0_ACTOR_A_ROOT[0] + PHASE0_LEFT_SHOULDER_IN_ROOT[0],
      PHASE0_ACTOR_A_ROOT[1] + PHASE0_LEFT_SHOULDER_IN_ROOT[1],
      PHASE0_ACTOR_A_ROOT[2] + PHASE0_LEFT_SHOULDER_IN_ROOT[2],
    ];
    for (let frame = 0; frame <= 48; frame += 1) {
      const hand = phase0LeftHandWorldPose(frame).translation;
      const reach = Math.hypot(hand[0] - shoulder[0], hand[1] - shoulder[1], hand[2] - shoulder[2]);
      expect(reach).toBeLessThanOrEqual(PHASE0_STUB_ARM_LENGTH_M + 1e-9);
    }
    const release = phase0LeftHandWorldPose(48).translation;
    const releaseReach = Math.hypot(release[0] - shoulder[0], release[1] - shoulder[1], release[2] - shoulder[2]);
    expect(releaseReach).toBeGreaterThan(0.5);
    expect(releaseReach).toBeLessThanOrEqual(PHASE0_STUB_ARM_LENGTH_M);
  });

  it("uses a recorded front axis and handedness, and the defaults only when they are absent", () => {
    expect(environmentImportTransform({
      coordinateSystem: "Y_UP",
      unitScaleMeters: 1,
      handedness: "right",
      frontAxis: "+Z",
    })).toBeUndefined();

    const facingX = environmentImportTransform({
      coordinateSystem: "Y_UP",
      unitScaleMeters: 1,
      handedness: "right",
      frontAxis: "+X",
    });
    expect(facingX).toBeDefined();
    expect(applyImportTransform(facingX!, [1, 0, 0])[2]).toBeCloseTo(1, 6);

    const left = environmentImportTransform({
      coordinateSystem: "Y_UP",
      unitScaleMeters: 1,
      handedness: "left",
      frontAxis: "+Z",
    });
    expect(applyImportTransform(left!, [1, 0, 0])[0]).toBeCloseTo(-1, 6);

    const defaultZ = environmentImportTransform({ coordinateSystem: "Z_UP", unitScaleMeters: 1 });
    expect(environmentImportTransform({
      coordinateSystem: "Z_UP",
      unitScaleMeters: 1,
      handedness: "right",
      frontAxis: "-Y",
    })).toEqual(defaultZ);
    expect(environmentImportTransform({
      coordinateSystem: "Z_UP",
      unitScaleMeters: 1,
      frontAxis: "+X",
    })).not.toEqual(defaultZ);
  });
});

describe("legacy shot migration", () => {
  const legacy = (): Shot => parseShot({
    schemaVersion: 1,
    id: "clip-001",
    name: "Legacy",
    time: { fps: 24, durationFrames: 24, origin: "clip_local" },
    subjects: [
      {
        id: "subject-abc",
        assetId: "file:ab12cd34",
        assetVersion: 3,
        name: "Hero",
        uri: "hero.glb",
        placement: { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        kind: "human",
        representation: "mesh",
        motion: { channel: "unset" },
      },
      {
        id: "subject-def",
        assetId: "primitive:sphere",
        assetVersion: 1,
        name: "Ball",
        uri: "primitive:sphere",
        placement: { position: [1, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        kind: "object",
        representation: "sphere",
        motion: { channel: "unset" },
      },
    ],
    camera: { status: "empty", lens: { focalLengthMm: 35 }, interpolation: "linear" },
    renders: [],
  });

  it("assigns the same ids on a second pass and keeps legacy refs", () => {
    const once = linkShotSubjects(legacy());
    const twice = linkShotSubjects(legacy());
    const again = linkShotSubjects(once);
    expect(posed(once).map((subject) => subject.instanceId)).toEqual(posed(twice).map((subject) => subject.instanceId));
    expect(posed(again).map((subject) => subject.instanceId)).toEqual(posed(once).map((subject) => subject.instanceId));
    expect(posed(once)[0]?.instanceId).toBe(legacyShotInstanceId("human", "clip-001", "subject-abc"));
    expect(posed(once)[0]?.assetRef).toEqual({
      assetId: persistentAssetIdForLegacy("file:ab12cd34"),
      revisionId: revisionIdForAssetVersion("file:ab12cd34", 3),
    });
    expect(posed(once)[0]?.assetRef?.revisionId).toBe("rev_legacy_file_ab12cd34__v3");
    expect(posed(once)[1]?.assetRef?.assetId).toBe("ast_legacy_primitive_sphere");
    expect(posed(once)[0]?.legacyRefs).toEqual(expect.arrayContaining([
      { kind: "shot_subject", shotId: "clip-001", subjectId: "subject-abc" },
      { kind: "shot_asset", assetId: "file:ab12cd34" },
    ]));
    expect(posed(once)[1]?.legacyRefs).toEqual(expect.arrayContaining([
      { kind: "shot_asset", assetId: "primitive:sphere" },
    ]));
    expect(once.subjects[0]?.id).toBe("subject-abc");
  });
});

describe("euler adapter", () => {
  it("round-trips XYZ euler through a quaternion within tolerance", () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 0],
      [0.3, -0.4, 0.5],
      [0, 0.8, 0],
      [-0.2, 0.1, -0.3],
    ];
    for (const euler of samples) {
      const quat = eulerToQuaternion(euler);
      const back = quaternionToEuler(quat);
      expect(back[0]).toBeCloseTo(euler[0], 6);
      expect(back[1]).toBeCloseTo(euler[1], 6);
      expect(back[2]).toBeCloseTo(euler[2], 6);
      const length = Math.hypot(...quat);
      expect(length).toBeCloseTo(1, 6);
    }
  });
});

describe("contact graph", () => {
  it("uses #30 part names and derives actors from a and b", () => {
    const handshakeScope = phase0ContactScope("handshake_01");
    expect(handshakeScope).toEqual({ kind: "contact", contact_id: "handshake_01" });
    const handshake = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === handshakeScope.contact_id);
    const hold = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === phase0ContactScope("cup_hold_01").contact_id);
    const place = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === phase0ContactScope("cup_place_01").contact_id);
    expect(handshake?.a).toEqual({ actor: "actor-a", part: "right_hand" });
    expect(handshake?.b).toEqual({ actor: "actor-b", part: "right_hand" });
    expect(hold?.a).toEqual({ actor: "actor-a", part: "left_hand" });
    expect(hold?.b.actor).toBe("object-cup");
    expect(place?.a).toEqual({ actor: "object-cup" });
    expect(place?.b).toEqual({ actor: "object-table" });
    expect(place?.a.part).toBeUndefined();
    expect(place?.b.part).toBeUndefined();

    const plan = phase0PerformancePlan();
    const cue = plan.cues.find((item) => item.contactId === handshakeScope.contact_id);
    expect(cue?.actorId).toBe(handshake?.a.actor);
    expect(cue?.targetActorId).toBe(handshake?.b.actor);
    expect(cue?.rigPart).toBe(handshake?.a.part);
    expect(cue?.targetRigPart).toBe(handshake?.b.part);
    const saved = performancePlanFromNode(JSON.parse(JSON.stringify(plan)) as Record<string, unknown>);
    expect(saved.cues.find((item) => item.id === "handshake")?.contactId).toBe(handshakeScope.contact_id);

    const attachments = phase0Scene().objects["object-cup"]?.attachments ?? [];
    const held = attachments.find((item) => item.sourceContactId === hold?.contact_id);
    const placed = attachments.find((item) => item.sourceContactId === place?.contact_id);
    expect(held?.parentInstanceId).toBe(hold?.a.actor);
    expect(held?.rigPart).toBe(hold?.a.part);
    expect(placed?.parentInstanceId).toBe(place?.b.actor);
    expect(placed?.rigPart).toBeUndefined();
  });
});

describe("generated performance source", () => {
  it("keeps generated and handshake hands across save and load", () => {
    const plan = phase0PerformancePlan();
    const loaded = performancePlanFromNode(JSON.parse(JSON.stringify(plan)) as Record<string, unknown>);
    expect(loaded.sources[0]?.type).toBe("generated");
    expect(loaded.sources[0]?.notes).toBe("컵은 여기 둘게.");
    const handshake = loaded.cues.find((cue) => cue.id === "handshake");
    expect(handshake?.rigPart).toBe("right_hand");
    expect(handshake?.targetRigPart).toBe("right_hand");
    const edited = performancePlanFromNode({
      ...loaded,
      cues: loaded.cues.map((cue) => cue.id === "handshake" ? { ...cue, targetRigPart: "left_hand" } : cue),
    });
    expect(edited.cues.find((cue) => cue.id === "handshake")?.targetRigPart).toBe("left_hand");
  });

  it("still maps an unknown source type to text_prompt", () => {
    const plan = performancePlanFromNode({
      sources: [{ id: "old", type: "speech_draft", label: "Old", notes: "hello", enabled: true }],
    });
    expect(plan.sources[0]?.type).toBe("text_prompt");
  });
});

describe("project load scene link", () => {
  it("does not rebuild a valid shot from the graph after the instance link", () => {
    const project = phase0Project();
    const linked = projectWithShots(project);
    const renamedGraph: Project = {
      ...linked,
      nodes: {},
    };
    expect(projectWithShots(renamedGraph).shots?.["shot-handshake-cup"]?.subjects[0]?.name).toBe("A");
    expect(projectWithShots(renamedGraph).shots?.["shot-handshake-cup"]?.camera.status).toBe("ready");
  });
});
