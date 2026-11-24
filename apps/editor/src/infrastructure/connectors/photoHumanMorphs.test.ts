import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Skeleton, SkinnedMesh } from "three";
import { describe, expect, it } from "vitest";
import { preparePhotoHumanExpressions } from "./photoHumanMorphs";

const target = (name: string, values: number[]) => {
  const attribute = new Float32BufferAttribute(values, 3);
  attribute.name = name;
  return attribute;
};

describe("preparePhotoHumanExpressions", () => {
  it("splits a symmetric mouth shape into webcam left and right channels that sum to the original", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0.05, 0, 0, -0.05, 0, 0, 0, 0, 0], 3));
    geometry.morphAttributes.position = [target("mouthSmile", [0, 1, 0, 0, 2, 0, 0, 4, 0]), target("jawOpen", [0, -1, 0, 0, -1, 0, 0, -1, 0])];
    const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
    mesh.bind(new Skeleton([]));
    mesh.updateMorphTargets();

    preparePhotoHumanExpressions(mesh);

    expect(Object.keys(mesh.morphTargetDictionary ?? {}).sort()).toEqual(["jawOpen", "mouthSmileLeft", "mouthSmileRight"]);
    const shape = (name: string) => geometry.morphAttributes.position![mesh.morphTargetDictionary![name]];
    const left = shape("mouthSmileLeft"), right = shape("mouthSmileRight");
    expect([0, 1, 2].map((vertex) => left.getY(vertex) + right.getY(vertex))).toEqual([1, 2, 4]);
    expect(left.getY(0)).toBe(1);
    expect(right.getY(1)).toBe(2);
    expect(shape("jawOpen").getY(2)).toBe(-1);
  });
});
