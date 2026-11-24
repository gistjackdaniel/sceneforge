import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { applyLiveFace, bindFaceRig, readFaceWeights } from "./faceRig";

const actor = () => {
  const geometry = new BufferGeometry();
  const vertices = new Float32Array(9);
  geometry.morphAttributes.position = ["ARKit.JawOpen", "eye_blink_left", "clothesSize"].map((name) => {
    const morph = new BufferAttribute(vertices, 3);
    morph.name = name;
    return morph;
  });
  const mesh = new Mesh(geometry);
  mesh.morphTargetInfluences = [0.12, 0.03, 0.28];
  return { mesh, bindings: bindFaceRig(new Group().add(mesh)) };
};

describe("live facial expressions", () => {
  it("animates only the selected actor and restores its original face on a switch or stop", () => {
    const a = actor();
    const b = actor();
    const weights = readFaceWeights([
      { categoryName: "jawOpen", score: 0.72 },
      { categoryName: "eyeBlinkLeft", score: 1.01 },
      { categoryName: "clothesSize", score: 0.8 },
    ]);
    applyLiveFace(a.bindings, "a", { subjectId: "a", weights });
    applyLiveFace(b.bindings, "b", { subjectId: "a", weights });
    expect(a.mesh.morphTargetInfluences).toEqual([0.72, 1, 0.28]);
    expect(b.mesh.morphTargetInfluences).toEqual([0.12, 0.03, 0.28]);

    applyLiveFace(a.bindings, "a", { subjectId: "b", weights });
    applyLiveFace(b.bindings, "b", { subjectId: "b", weights });
    expect(a.mesh.morphTargetInfluences).toEqual([0.12, 0.03, 0.28]);
    expect(b.mesh.morphTargetInfluences).toEqual([0.72, 1, 0.28]);

    applyLiveFace(b.bindings, "b", null);
    expect(b.mesh.morphTargetInfluences).toEqual([0.12, 0.03, 0.28]);
  });
});
