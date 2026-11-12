import { describe, expect, it } from "vitest";
import { performancePlanFromNode } from "../performance/plan";
import { projectWithShots } from "../project/migrateToShot";
import { targetResolverForProject } from "../project/sceneLink";
import type { Project } from "../project/types";
import { deserializeProject, serializeProject } from "../../infrastructure/persistence/serializeProject";
import { applyImportTransform, shotFps } from "../worlds/coordinates";
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
import { bakeDenseObjectMotion, worldMatrixFromShotPose } from "./motionBake";
import { environmentImportTransform, prepareModelInput } from "./modelInput";
import {
  PHASE0_DURATION_FRAMES,
  PHASE0_FPS,
  phase0CupDenseFrames,
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
    expect(baked.keys[0]?.position[0]).toBeCloseTo(0.15, 6);
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
