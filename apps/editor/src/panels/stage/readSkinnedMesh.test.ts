import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readGlbRig } from "./readSkinnedMesh";

const bone = (name: string): THREE.Bone => {
  const joint = new THREE.Bone();
  joint.name = name;
  return joint;
};

const skinned = (skeleton: THREE.Skeleton, name: string): THREE.SkinnedMesh => {
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
};

describe("readGlbRig", () => {
  it("keeps duplicate names, shares one skeleton across meshes, and appends the next skin", () => {
    const shared = new THREE.Skeleton([bone("pelvis"), bone("pelvis")]);
    const other = new THREE.Skeleton([bone("head")]);
    const root = new THREE.Group();
    root.name = "Armature";
    root.add(skinned(shared, "Body"), skinned(shared, "Cloth"), new THREE.Mesh(), skinned(other, "Hair"));
    expect(readGlbRig(root)).toMatchObject({
      nodeName: "Armature",
      bones: [{ name: "pelvis" }, { name: "pelvis" }, { name: "head" }],
      restTranslation: [0, 0, 0],
      restRotation: [0, 0, 0, 1],
      restScale: [1, 1, 1],
    });
  });

  it("reads joints once when glTF skins give each mesh its own Skeleton of the same bones", () => {
    const joints = [bone("mixamorigHips"), bone("mixamorigHead")];
    const root = new THREE.Group();
    root.add(skinned(new THREE.Skeleton(joints), "body"), skinned(new THREE.Skeleton(joints), "hair"));
    expect(readGlbRig(root).bones).toEqual([{ name: "mixamorigHips" }, { name: "mixamorigHead" }]);
  });

  it("returns no bones for a model without SkinnedMesh", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    expect(readGlbRig(root).bones).toEqual([]);
  });
});
