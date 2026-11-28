import { readFileSync } from "node:fs";
import { Bone, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { bindSomaRig } from "./somaRetarget";
import { aimUpperBody, readUpperBodyAims, smoothAims, type PoseLandmark } from "./upperBody";

// A person facing the camera in MediaPipe world space: x toward the image's right, which is the person's left, y down.
const person = (overrides: Record<number, Partial<PoseLandmark>> = {}): PoseLandmark[] => {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.99 }));
  const place = (index: number, x: number, y: number, z = 0) => { landmarks[index] = { x, y, z, visibility: 0.99 }; };
  place(11, 0.2, -0.5); place(12, -0.2, -0.5);
  place(13, 0.45, -0.5); place(14, -0.2, -0.2);
  place(15, 0.7, -0.5); place(16, -0.2, 0.05);
  place(23, 0.1, 0); place(24, -0.1, 0);
  for (const [index, value] of Object.entries(overrides)) landmarks[Number(index)] = { ...landmarks[Number(index)], ...value };
  return landmarks;
};

const loadActor = () => {
  const bytes = readFileSync(new URL("../../../public/meshes/phase1/actor-b.glb", import.meta.url));
  const glb: { nodes: Array<{ name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }>; scenes: Array<{ nodes: number[] }>; skins: Array<{ joints: number[] }> }
    = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
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
};

describe("webcam upper body", () => {
  it("reads the person's own left arm as the actor's left, held out sideways", () => {
    const aims = readUpperBodyAims(person());
    expect(aims.LeftArm?.[0]).toBeCloseTo(1);
    expect(aims.LeftForeArm?.[0]).toBeCloseTo(1);
    expect(aims.RightArm?.[1]).toBeCloseTo(-1);
    expect(aims.Chest?.[1]).toBeCloseTo(1);
  });

  it("leaves out bones whose joints the camera cannot see", () => {
    const aims = readUpperBodyAims(person({ 15: { visibility: 0.1 }, 23: { visibility: 0.2 } }));
    expect(aims.LeftArm).toBeDefined();
    expect(aims.LeftForeArm).toBeUndefined();
    expect(aims.Chest).toBeUndefined();
  });

  it("eases toward new directions and stays unit length", () => {
    const eased = smoothAims({ LeftArm: [1, 0, 0] }, { LeftArm: [0, 1, 0], RightArm: [0, -1, 0] });
    expect(eased.LeftArm?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(eased.LeftArm?.[1]).toBeCloseTo(Math.SQRT1_2);
    expect(eased.RightArm).toEqual([0, -1, 0]);
  });

  it("points the actor's arm segments along the webcam directions", () => {
    const actor = loadActor();
    actor.rotation.y = Math.PI / 2;
    actor.updateWorldMatrix(true, true);
    const rig = bindSomaRig(actor);
    const bone = (name: string) => rig.joints.find((joint) => joint.sourceName === name)!.bone;
    aimUpperBody(rig, readUpperBodyAims(person()));
    const direction = (from: string, to: string) => bone(to).getWorldPosition(new Vector3()).sub(bone(from).getWorldPosition(new Vector3())).normalize();
    // The actor faces +X after its turn, so its own left (+X in actor space) is world -Z.
    expect(direction("LeftArm", "LeftForeArm").dot(new Vector3(0, 0, -1))).toBeGreaterThan(0.99);
    expect(direction("RightArm", "RightForeArm").dot(new Vector3(0, -1, 0))).toBeGreaterThan(0.99);
  });
});
