import { describe, expect, it } from "vitest";
import { eulerToQuaternion } from "../shot/eulerAdapter";
import {
  PHASE0_ACTOR_A_ROOT,
  PHASE0_CONTACT_GRAPH,
  PHASE0_SHOT_ID,
  phase0Scene,
} from "../shot/phase0Sample";
import { appendAssetRevision, cloneInstance, deleteInstance, jointForRigPart } from "./sceneState";
import { applyImportTransform, type Mat4 } from "./coordinates";
import { WorldDomainError } from "./errors";
import { createPersistentIdFactory, newIdSchema } from "./ids";
import { environmentImportTransform } from "../shot/modelInput";
import {
  collectImportedBones,
  convertSourceRotation,
  importRiggedActor,
  invertImportTransform,
  mapImportedRigParts,
  riggedActorImportTransform,
  type RiggedActorImportSource,
} from "./riggedActorImport";

const zeroBytes = (): Uint8Array => new Uint8Array(10);

const factory = () => createPersistentIdFactory({ now: () => 0, randomBytes: zeroBytes });

const rotate = (quat: readonly [number, number, number, number], point: readonly [number, number, number]) => {
  const [x, y, z, w] = quat;
  const [px, py, pz] = point;
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ];
};

const closeVec = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual[0]).toBeCloseTo(expected[0] ?? 0, 5);
  expect(actual[1]).toBeCloseTo(expected[1] ?? 0, 5);
  expect(actual[2]).toBeCloseTo(expected[2] ?? 0, 5);
};

const actorSource = (patch: Partial<RiggedActorImportSource> = {}): RiggedActorImportSource => ({
  assetId: "ast_phase0_a",
  revisionId: "rev_phase0_a_v1",
  sourcePath: "meshes/phase0/actor-a.glb",
  nodeName: "Armature",
  label: "A",
  bones: [
    { name: "pelvis" },
    { name: "left_wrist" },
    { name: "right_wrist" },
    { name: "head" },
    { name: "spine1" },
  ],
  restTranslation: [0, 0, 0],
  ...patch,
});

describe("rigged actor import ids", () => {
  it("mints act_<ULID> on the first import", () => {
    const scene = phase0Scene();
    const imported = importRiggedActor(scene, actorSource(), factory());
    expect(imported.minted).toBe(true);
    expect(imported.actor.id).toBe(`act_${"0".repeat(26)}`);
    expect(newIdSchema("act").safeParse(imported.actor.id).success).toBe(true);
    expect(imported.scene.actors[imported.actor.id]?.importKey).toBe(imported.sourceKey);
    expect(imported.actor.assetRef).toEqual({ assetId: "ast_phase0_a", revisionId: "rev_phase0_a_v1" });
    expect(imported.partMap.right_hand).toBe("right_wrist");
    expect(JSON.stringify(scene.actors)).toBe(JSON.stringify(phase0Scene().actors));
  });

  it("keeps the id when the same source is imported again", () => {
    const scene = phase0Scene();
    const ids = factory();
    const first = importRiggedActor(scene, actorSource({ restTranslation: [1, 2, 3] }), ids);
    const again = importRiggedActor(
      first.scene,
      actorSource({
        label: "Renamed in the file",
        sourcePath: ".\\meshes\\phase0\\actor-a.glb",
        restTranslation: [9, 9, 9],
      }),
      ids,
    );
    expect(again.minted).toBe(false);
    expect(again.actor.id).toBe(first.actor.id);
    expect(again.actor.label).toBe("A");
    expect(again.actor.restTransform.translation).toEqual([1, 2, 3]);
    expect(Object.values(again.scene.actors).filter((actor) => actor.importKey === first.sourceKey)).toHaveLength(1);
    const removed = deleteInstance(again.scene, first.actor.id, "2026-11-12T00:00:00.000Z");
    const afterDelete = importRiggedActor(removed, actorSource(), ids);
    expect(afterDelete.actor.id).toBe(first.actor.id);
    expect(afterDelete.actor.deletedAt).toBe("2026-11-12T00:00:00.000Z");
    expect(afterDelete.minted).toBe(false);
  });

  it("mints a different id for a different path, node, or revision", () => {
    const scene = phase0Scene();
    const ids = factory();
    const first = importRiggedActor(scene, actorSource(), ids);
    const otherFile = importRiggedActor(
      first.scene,
      actorSource({
        assetId: "ast_phase0_b",
        revisionId: "rev_phase0_b_v1",
        sourcePath: "meshes/phase0/actor-b.glb",
        label: "B",
      }),
      ids,
    );
    const otherNode = importRiggedActor(otherFile.scene, actorSource({ nodeName: "armature" }), ids);
    const revision = scene.revisions.rev_phase0_a_v1;
    if (!revision) throw new Error("missing phase 0 revision");
    const nextRevisionId = ids.mint("rev");
    const appended = appendAssetRevision(otherNode.scene, {
      ...revision,
      revisionId: nextRevisionId,
      revision: revision.revision + 1,
      parentRevisionId: revision.revisionId,
      contentHash: "legacy-fingerprint:ast_phase0_a:2:meshes/phase0/actor-a.glb",
      createdAt: "2026-11-12T01:00:00.000Z",
    });
    const otherRevision = importRiggedActor(appended, actorSource({ revisionId: nextRevisionId }), ids);
    expect(new Set([first.actor.id, otherFile.actor.id, otherNode.actor.id, otherRevision.actor.id]).size).toBe(4);
    expect(() => importRiggedActor(scene, actorSource({ revisionId: "rev_missing", assetId: "ast_missing" }), ids)).toThrow(
      WorldDomainError,
    );
  });

  it("keeps subject-* and actor-a on legacyRefs", () => {
    const scene = phase0Scene();
    const imported = importRiggedActor(
      scene,
      actorSource({
        legacySubjectId: "subject-abc",
        legacyAssetId: "file:ab12cd34",
        shotId: PHASE0_SHOT_ID,
      }),
      factory(),
    );
    expect(imported.actor.id.startsWith("act_")).toBe(true);
    expect(imported.actor.id).not.toBe("subject-abc");
    expect(imported.actor.legacyRefs).toEqual([
      { kind: "shot_subject", shotId: PHASE0_SHOT_ID, subjectId: "subject-abc" },
      { kind: "shot_asset", assetId: "file:ab12cd34" },
    ]);
    const withActorA = importRiggedActor(
      imported.scene,
      actorSource({
        sourcePath: "meshes/phase0/actor-a.glb",
        nodeName: "ActorA",
        legacySubjectId: "actor-a",
        shotId: PHASE0_SHOT_ID,
        legacyAssetId: "ast_phase0_a",
      }),
      factory(),
    );
    expect(withActorA.scene.actors["actor-a"]?.id).toBe("actor-a");
    expect(withActorA.actor.legacyRefs).toEqual([
      { kind: "shot_subject", shotId: PHASE0_SHOT_ID, subjectId: "actor-a" },
      { kind: "shot_asset", assetId: "ast_phase0_a" },
    ]);
    const repeated = importRiggedActor(
      withActorA.scene,
      actorSource({
        legacySubjectId: "subject-abc",
        legacyAssetId: "file:ab12cd34",
        shotId: PHASE0_SHOT_ID,
      }),
      factory(),
    );
    expect(repeated.actor.id).toBe(imported.actor.id);
    expect(repeated.actor.legacyRefs).toEqual(imported.actor.legacyRefs);
  });

  it("does not give a clone the import key", () => {
    const scene = phase0Scene();
    const ids = factory();
    const imported = importRiggedActor(scene, actorSource(), ids);
    const cloneId = ids.mint("act");
    const cloned = cloneInstance(imported.scene, imported.actor.id, cloneId, "A copy");
    expect(cloned.actors[cloneId]?.importKey).toBeUndefined();
    expect(cloned.actors[cloneId]?.clonedFrom).toBe(imported.actor.id);
    const again = importRiggedActor(cloned, actorSource(), ids);
    expect(again.actor.id).toBe(imported.actor.id);
  });
});

describe("rig part mapping", () => {
  it("maps phase 0 actor-a and actor-b onto handshake_01 and cup_hold_01", () => {
    const scene = phase0Scene();
    const handshake = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === "handshake_01");
    const hold = PHASE0_CONTACT_GRAPH.find((item) => item.contact_id === "cup_hold_01");
    expect(handshake?.a).toEqual({ actor: "actor-a", part: "right_hand" });
    expect(handshake?.b).toEqual({ actor: "actor-b", part: "right_hand" });
    expect(hold?.a).toEqual({ actor: "actor-a", part: "left_hand" });

    const bonesFor = (revisionId: string) => {
      const partMap = scene.revisions[revisionId]?.rig?.partMap ?? {};
      const armature = {
        name: "Armature",
        children: [
          ...Object.values(partMap).map((name) => ({ name, isBone: true })),
          { name: "spine1", isBone: true },
          { name: "left_elbow", isBone: true },
          { name: "jaw", isBone: true },
          { name: "left_thumb_01", isBone: true },
        ],
      };
      return collectImportedBones(armature);
    };

    const mappedA = mapImportedRigParts(bonesFor("rev_phase0_a_v1"), scene.revisions.rev_phase0_a_v1?.rig?.partMap);
    const mappedB = mapImportedRigParts(bonesFor("rev_phase0_b_v1"), scene.revisions.rev_phase0_b_v1?.rig?.partMap);
    expect(mappedA.partMap[handshake!.a.part!]).toBe("right_wrist");
    expect(mappedB.partMap[handshake!.b.part!]).toBe("right_wrist");
    expect(mappedA.partMap[hold!.a.part!]).toBe("left_wrist");
    expect(jointForRigPart("right_hand", mappedA.partMap)).toBe("right_wrist");
    expect(jointForRigPart("left_hand", mappedA.partMap)).toBe("left_wrist");
    expect(mappedA.diagnostics.filter((item) => item.kind === "part")).toEqual([]);
    expect(mappedA.diagnostics).toEqual([
      { kind: "bone", bone: "jaw", reason: "unmapped" },
      { kind: "bone", bone: "left_elbow", reason: "unmapped" },
      { kind: "bone", bone: "left_thumb_01", reason: "unmapped" },
      { kind: "bone", bone: "spine1", reason: "unmapped" },
    ]);
    expect(mappedB.diagnostics.filter((item) => item.kind === "bone").map((item) => item.kind === "bone" && item.bone)).toEqual(
      mappedA.diagnostics.filter((item) => item.kind === "bone").map((item) => item.kind === "bone" && item.bone),
    );

    const imported = importRiggedActor(
      scene,
      actorSource({ bones: bonesFor("rev_phase0_a_v1"), nodeName: "ActorA" }),
      factory(),
    );
    expect(imported.partMap.right_hand).toBe(mappedA.partMap.right_hand);
    expect(imported.partMap.left_hand).toBe(mappedA.partMap.left_hand);
    expect(imported.diagnostics).toEqual(mappedA.diagnostics);
  });

  it("maps DCC joint names and reports ambiguous or missing parts", () => {
    const mapped = mapImportedRigParts([
      { name: "mixamorig:Hips" },
      { name: "mixamorig:LeftHand" },
      { name: "mixamorig:RightHand" },
      { name: "Bip001 L Foot" },
      { name: "오른손" },
      { name: "Hand" },
      { name: "unknown_joint" },
    ]);
    expect(mapped.partMap.pelvis).toBe("mixamorig:Hips");
    expect(mapped.partMap.left_hand).toBe("mixamorig:LeftHand");
    expect(mapped.partMap.right_hand).toBe("mixamorig:RightHand");
    expect(mapped.partMap.left_foot).toBe("Bip001 L Foot");
    expect(mapImportedRigParts([{ name: "오른손" }]).partMap.right_hand).toBe("오른손");
    expect(mapImportedRigParts([{ name: "왼손" }]).partMap.left_hand).toBe("왼손");
    expect(mapped.diagnostics).toEqual([
      { kind: "bone", bone: "Hand", reason: "ambiguous", candidates: ["left_hand", "right_hand"] },
      { kind: "bone", bone: "unknown_joint", reason: "unmapped" },
      { kind: "bone", bone: "오른손", reason: "ambiguous", candidates: ["right_hand"] },
      { kind: "part", part: "head", reason: "missing" },
      { kind: "part", part: "right_foot", reason: "missing" },
    ]);
    const custom = mapImportedRigParts([{ name: "R_HandSocket" }, { name: "spine1" }], { right_hand: "R_HandSocket" });
    expect(custom.partMap.right_hand).toBe("R_HandSocket");
    expect(custom.diagnostics.some((item) => item.kind === "bone" && item.bone === "spine1" && item.reason === "unmapped")).toBe(
      true,
    );
  });
});

describe("rigged actor coordinate contract", () => {
  it("round-trips source points and rotations into the canonical scene", () => {
    const zUp = {
      coordinateSystem: "Z_UP" as const,
      unitScaleMeters: 0.01,
      handedness: "right" as const,
      frontAxis: "-Y" as const,
    };
    const matrix = riggedActorImportTransform(zUp);
    expect(matrix).toEqual(environmentImportTransform(zUp));
    expect(matrix).toBeDefined();
    const inverse = invertImportTransform(matrix as Mat4);
    const samples: Array<[number, number, number]> = [
      [0, -100, 0],
      [100, 0, 0],
      [0, 0, 100],
      [12.5, -40, 80],
    ];
    for (const point of samples) {
      const canonical = applyImportTransform(matrix as Mat4, point);
      closeVec(applyImportTransform(inverse, canonical), point);
    }
    const left = riggedActorImportTransform({ upAxis: "Y", handedness: "left", frontAxis: "+Z", metersPerUnit: 1 });
    expect(left).toEqual(environmentImportTransform({ coordinateSystem: "Y_UP", unitScaleMeters: 1, handedness: "left", frontAxis: "+Z" }));
    const leftInverse = invertImportTransform(left as Mat4);
    closeVec(applyImportTransform(leftInverse, applyImportTransform(left as Mat4, [1, 2, 3])), [1, 2, 3]);

    const explicitFront = riggedActorImportTransform({ coordinateSystem: "Z_UP", unitScaleMeters: 1, frontAxis: "+X" });
    const defaultFront = riggedActorImportTransform({ coordinateSystem: "Z_UP", unitScaleMeters: 1 });
    expect(explicitFront).not.toEqual(defaultFront);
    expect(explicitFront).toEqual(
      environmentImportTransform({ coordinateSystem: "Z_UP", unitScaleMeters: 1, frontAxis: "+X" }),
    );
    expect(riggedActorImportTransform({ metersPerUnit: 0.01, upAxis: "Z" })).toEqual(
      riggedActorImportTransform({ unitScaleMeters: 0.01, coordinateSystem: "Z_UP" }),
    );
    expect(riggedActorImportTransform({ upAxis: "Y", handedness: "right", frontAxis: "+Z", metersPerUnit: 1 })).toBeUndefined();

    const sourcePoint: [number, number, number] = [100, -250, 80];
    const imported = importRiggedActor(
      phase0Scene(),
      actorSource({ restTranslation: sourcePoint, sourceAxes: zUp, nodeName: "ActorA_Root" }),
      factory(),
    );
    closeVec(imported.actor.restTransform.translation, applyImportTransform(matrix as Mat4, sourcePoint));
    closeVec(applyImportTransform(inverse, imported.actor.restTransform.translation), sourcePoint);
    expect(imported.scene.contract.handedness).toBe("right");
    expect(imported.scene.contract.upAxis).toBe("Y");
    expect(imported.scene.contract.forwardAxis).toBe("+Z");
    expect(imported.scene.contract.unit).toBe("meter");

    const canonical = importRiggedActor(
      phase0Scene(),
      actorSource({ restTranslation: PHASE0_ACTOR_A_ROOT, nodeName: "CanonicalRoot" }),
      factory(),
    );
    expect(canonical.importTransform).toBeUndefined();
    expect(canonical.actor.restTransform.translation).toEqual([...PHASE0_ACTOR_A_ROOT]);

    const rotation = eulerToQuaternion([0.2, -0.4, 0.3]);
    const converted = convertSourceRotation(matrix, rotation);
    const restored = convertSourceRotation(inverse, converted);
    for (const vector of samples) {
      closeVec(rotate(restored, vector), rotate(rotation, vector));
    }
    const turned = importRiggedActor(
      phase0Scene(),
      actorSource({
        nodeName: "Turned",
        sourceAxes: zUp,
        restRotation: rotation,
        restTranslation: [0, 0, 0],
      }),
      factory(),
    );
    closeVec(rotate(turned.actor.restTransform.rotation, [1, 0, 0]), rotate(converted, [1, 0, 0]));
  });
});
