import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Bone, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { sampleSomaMotion, somaHeading, somaJointPose, somaMotionSchema } from "../../domain/sceneAuthoring/somaMotion";
import waveWalkRoot from "../../domain/sceneAuthoring/fixtures/wave-walk-root.json";
import { applySomaFrame, bindSomaRig } from "./somaRetarget";

const loadMotion = (name: string) => somaMotionSchema.parse(JSON.parse(readFileSync(
  new URL(`../../../public/motions/${name}.json`, import.meta.url), "utf8",
)));

function loadActorFixture() {
  const bytes = readFileSync(new URL("../../../public/meshes/phase1/actor-b.glb", import.meta.url));
  const glb: {
    nodes: Array<{ name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }>;
    scenes: Array<{ nodes: number[] }>;
    skins: Array<{ joints: number[] }>;
  } = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  const bones = new Set(glb.skins[0].joints);
  const nodes = glb.nodes.map((source, index) => {
    const node = bones.has(index) ? new Bone() : new Object3D();
    node.name = source.name ?? "";
    if (source.translation) node.position.fromArray(source.translation);
    if (source.rotation) node.quaternion.fromArray(source.rotation);
    if (source.scale) node.scale.fromArray(source.scale);
    return node;
  });
  glb.nodes.forEach(({ children }, index) => children?.forEach((id) => nodes[index].add(nodes[id])));
  return new Object3D().add(...glb.scenes[0].nodes.map((id) => nodes[id]));
}

describe("Kimodo SOMA-77 clips", () => {
  it("retains the original Actor A root at every source frame", () => {
    const original = loadMotion("wave-walk");
    const rootBytes = Buffer.alloc(original.frames.length * 3 * Float32Array.BYTES_PER_ELEMENT);
    original.frames.forEach((frame, index) => {
      expect(frame.rootPosition).toEqual(waveWalkRoot.frames[index].position);
      expect(somaHeading(frame)).toBeCloseTo(waveWalkRoot.frames[index].rotationEuler[1], 6);
      frame.rootPosition.forEach((coordinate, axis) => rootBytes.writeFloatLE(coordinate, (index * 3 + axis) * 4));
    });
    expect(createHash("sha256").update(rootBytes).digest("hex")).toBe(waveWalkRoot.rootSha256);
  });

  it("poses the imported actor's upper and lower body without changing either actor group or the other rig", () => {
    const actor = loadActorFixture();
    const other = loadActorFixture();
    actor.position.set(1, 1.2, -1);
    actor.rotation.y = 0.4;
    actor.scale.setScalar(0.8);
    const rig = bindSomaRig(actor);
    const wave = loadMotion("step-and-wave");
    const bow = loadMotion("step-and-bow");
    const walk = loadMotion("wave-walk");
    const wrist = actor.getObjectByName("Fist.R")!;
    const calf = actor.getObjectByName("LowerLeg.L")!;
    const otherWrist = other.getObjectByName(wrist.name)!;
    const otherRest = otherWrist.getWorldQuaternion(new Quaternion());
    const before = actor.matrixWorld.clone();

    const waved = wave.frames.map((frame) => {
      applySomaFrame(rig, wave, frame);
      return wrist.getWorldPosition(new Vector3()).y;
    });
    const bowed = bow.frames.map((frame) => {
      applySomaFrame(rig, bow, frame);
      return wrist.getWorldPosition(new Vector3()).y;
    });
    expect(Math.max(...waved) - Math.max(...bowed)).toBeGreaterThan(0.15);

    const frame = sampleSomaMotion(walk, 0.95);
    applySomaFrame(rig, walk, frame);
    const source = somaJointPose(walk, frame);
    const from = source[walk.joints.indexOf("LeftShin")];
    const to = source[walk.joints.indexOf("LeftFoot")];
    const sourceDirection = new Vector3(...to.position).sub(new Vector3(...from.position)).normalize()
      .applyAxisAngle(new Vector3(0, 1, 0), actor.rotation.y - somaHeading(frame));
    const foot = actor.getObjectByName("Foot.L")!;
    const targetDirection = foot.getWorldPosition(new Vector3()).sub(calf.getWorldPosition(new Vector3())).normalize();

    expect(targetDirection.dot(sourceDirection)).toBeGreaterThan(0.999);
    expect(actor.matrixWorld.elements).toEqual(before.elements);
    expect(otherWrist.getWorldQuaternion(new Quaternion()).toArray()).toEqual(otherRest.toArray());
  });
});
