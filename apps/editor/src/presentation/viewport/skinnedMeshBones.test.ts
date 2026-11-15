import { describe, expect, it } from "vitest";
import { gltfRiggedActorCommand } from "../../application/commands/gltfRiggedActor";
import {
  collectSkinnedMeshBoneNames,
  gltfRigNodeName,
  rigWarningsForActors,
  unmappedBoneWarnings,
  type SkinnedMeshSkeletonSource,
} from "./skinnedMeshBones";

const load = {
  worldId: "world-apartment-livingroom",
  assetId: "ast_phase0_a",
  revisionId: "rev_phase0_a_v1",
  sourcePath: "meshes/phase0/actor-a.glb",
  nodeName: "Armature",
  label: "A",
  restTranslation: [0, 0, 0] as [number, number, number],
  restRotation: [0, 0, 0, 1] as [number, number, number, number],
  restScale: [1, 1, 1] as [number, number, number],
};

describe("skinned mesh bone names", () => {
  it("concatenates several SkinnedMesh skeletons in traversal order", () => {
    const root = {
      name: "Scene",
      children: [
        {
          name: "Group",
          children: [{ name: "Body", isSkinnedMesh: true, skeleton: { bones: [{ name: "pelvis" }, { name: "head" }] } }],
        },
        { name: "Static" },
        { name: "Cloth", isSkinnedMesh: true, skeleton: { bones: [{ name: "left_wrist" }] } },
      ],
    };
    expect(collectSkinnedMeshBoneNames(root)).toEqual([
      { name: "pelvis" },
      { name: "head" },
      { name: "left_wrist" },
    ]);
    expect(gltfRigNodeName(root)).toBe("Scene");
  });

  it("keeps duplicate bone names and reads a shared skeleton once", () => {
    const shared: SkinnedMeshSkeletonSource = { bones: [{ name: "pelvis" }, { name: "pelvis" }, { name: "head" }] };
    const root = {
      children: [
        { name: "Body", isSkinnedMesh: true, skeleton: shared },
        { name: "Cloth", isSkinnedMesh: true, skeleton: shared },
        { isSkinnedMesh: false, skeleton: { bones: [{ name: "ignored" }] } },
      ],
    };
    expect(collectSkinnedMeshBoneNames(root)).toEqual([
      { name: "pelvis" },
      { name: "pelvis" },
      { name: "head" },
    ]);
    expect(gltfRigNodeName(root)).toBe("Body");
  });

  it("returns no bones and no import command when the model has no SkinnedMesh", () => {
    const root = { name: "Scene", children: [{ name: "Cube" }, { name: "Camera" }] };
    const bones = collectSkinnedMeshBoneNames(root);
    expect(bones).toEqual([]);
    expect(gltfRiggedActorCommand({ ...load, bones })).toBeUndefined();
  });
});

describe("unmapped bone warnings", () => {
  it("turns unmapped diagnostics into warnings and ignores other diagnostic kinds", () => {
    const diagnostics = [
      { kind: "bone", bone: "spine1", reason: "unmapped" },
      { kind: "bone", bone: "hand", reason: "ambiguous", candidates: ["left_hand", "right_hand"] },
      { kind: "part", part: "left_foot", reason: "missing" },
      { kind: "bone", bone: "  ", reason: "unmapped" },
      { kind: "bone", bone: "tail", reason: "unmapped" },
    ];
    expect(unmappedBoneWarnings(diagnostics)).toEqual(["경고: 매핑되지 않은 본 spine1, tail"]);
    expect(unmappedBoneWarnings({ kind: "bone" })).toEqual([]);
  });

  it("hides warnings after the actor leaves the scene", () => {
    const events = [{
      type: "RiggedActorImported",
      payload: {
        worldId: "world-1",
        actorId: "act_1",
        diagnostics: [{ kind: "bone", bone: "spine1", reason: "unmapped" }],
      },
    }];
    expect(rigWarningsForActors(events, "world-1", new Set(["act_1"]))).toEqual([
      "경고: 매핑되지 않은 본 spine1",
    ]);
    expect(rigWarningsForActors(events, "world-1", new Set())).toEqual([]);
    expect(rigWarningsForActors(events, "world-2", new Set(["act_1"]))).toEqual([]);
  });
});
