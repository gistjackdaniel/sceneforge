import { readFileSync } from "node:fs";
import { Bone, Group, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";
import { somaMotionSchema } from "../../domain/sceneAuthoring/somaMotion";
import { bindViewportActorMotion, type ViewportActorMotion } from "./actorMotionBinding";

it("evaluates actor motion in world space without changing editable placement and restores the rig outside the span", () => {
  const motion = somaMotionSchema.parse(JSON.parse(readFileSync(new URL("../../../public/motions/step-and-bow.json", import.meta.url), "utf8")));
  const placement = new Group();
  placement.position.set(1, 2, 3);
  placement.rotation.y = 0.4;
  placement.scale.set(0.65, 0.8, 1);
  const before = placement.position.toArray();
  const previousRotation = placement.quaternion.clone();
  const model = new Group();
  const bones = ["Hips", "Spine", "Neck", "Head"].map((name) => {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(0, 0.3, 0);
    return bone;
  });
  model.add(bones[0]);
  bones.slice(1).forEach((bone, index) => bones[index].add(bone));
  const binding = bindViewportActorMotion(placement, model);
  expect(binding.support.body).toBe(true);
  const pose: ViewportActorMotion = {
    position: [3, 1, -2], rotation: [0, 0, 0, 1], scale: [0.65, 0.8, 1],
    source: { motion, sample: motion.frames[45] },
  };
  binding.update("actor", pose, null);
  expect(model.getWorldPosition(new Vector3()).distanceTo(new Vector3(...pose.position))).toBeLessThan(1e-10);
  expect(model.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(1e-6);
  expect(placement.position.toArray()).toEqual(before);
  expect(placement.quaternion.equals(previousRotation)).toBe(true);
  expect(bones.some((bone) => bone.quaternion.angleTo(new Quaternion()) > 0.01)).toBe(true);
  binding.update("actor", undefined, null);
  expect(model.getWorldPosition(new Vector3()).toArray()).toEqual(before);
  expect(bones.every((bone) => bone.quaternion.equals(new Quaternion()))).toBe(true);
});
