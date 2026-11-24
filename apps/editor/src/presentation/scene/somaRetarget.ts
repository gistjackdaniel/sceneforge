import { Bone, Object3D, Quaternion, Vector3 } from "three";
import { somaHeading, somaJointPose, type SomaFrame, type SomaMotion } from "../../domain/sceneAuthoring/somaMotion";

interface JointBinding {
  sourceName: string;
  bone: Bone;
  restInActor: Quaternion;
  segment?: { endName: string; localDirection: Vector3 };
  ankle?: { shin: Bone; localPosition: Vector3 };
}

export interface SomaRig {
  root: Object3D;
  joints: readonly JointBinding[];
}

const normalizeBone = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, "");
const bodyJoints = {
  Hips: ["Hips", "Pelvis"],
  Spine1: ["Spine", "Abdomen", "Spine1"],
  Spine2: ["Spine1", "Spine2"],
  Chest: ["Chest", "UpperChest", "Torso", "Spine2"],
  Neck1: ["Neck", "Neck1"],
  Neck2: ["Neck2"],
  Head: ["Head"],
} as const;

const limbDefinition = [
  ["Shoulder", "Shoulder", "Clavicle"],
  ["Arm", "UpperArm", "UpperArm"],
  ["ForeArm", "LowerArm", "LowerArm"],
  ["Hand", "Fist", "Wrist"],
  ["Leg", "UpperLeg", "Thigh", "UpLeg"],
  ["Shin", "LowerLeg", "Calf", "Leg"],
  ["Foot", "Foot", "Ankle"],
  ["ToeBase", "ToeBase", "Toes", "Toe"],
] as const;

/** Capture the rig's bind orientation in actor space. The actor transform remains caller-owned. */
export function bindSomaRig(root: Object3D): SomaRig {
  const bonesByName = new Map<string, Bone>();
  root.traverse((node) => {
    if (node instanceof Bone) bonesByName.set(normalizeBone(node.name), node);
  });
  const sourceByBone = new Map<Bone, string>();
  const boneBySource = new Map<string, Bone>();
  const add = (sourceName: string, aliases: readonly string[]) => {
    for (const alias of aliases) {
      const bone = bonesByName.get(normalizeBone(alias));
      if (!bone || sourceByBone.has(bone)) continue;
      sourceByBone.set(bone, sourceName);
      boneBySource.set(sourceName, bone);
      break;
    }
  };
  const isCesium = bonesByName.has("body") && bonesByName.has("fistl") && bonesByName.has("abdomen");
  const isSomaSpine = bonesByName.has("spine1") && bonesByName.has("chest") && !bonesByName.has("spine");
  for (const [sourceName, aliases] of Object.entries(bodyJoints)) {
    if (sourceName === "Hips" && isCesium) add(sourceName, ["Body"]);
    else add(sourceName, isSomaSpine ? [sourceName, ...aliases] : aliases);
  }
  for (const [side, suffix] of [["Left", "L"], ["Right", "R"]] as const) {
    for (const [source, rig, ...aliases] of limbDefinition) {
      const isMixamoLeg = (source === "Leg" || source === "Shin") && bonesByName.has(normalizeBone(`${side}UpLeg`));
      const names = isMixamoLeg
        ? [`${side}${source === "Leg" ? "UpLeg" : "Leg"}`]
        : [`${side}${source}`, `${rig}${suffix}`, `${side}${rig}`, ...aliases.map((name) => `${side}${name}`)];
      add(`${side}${source}`, names);
    }
    for (const finger of ["Thumb", "Index", "Middle", "Ring", "Pinky"]) {
      for (const joint of [1, 2, 3, 4]) {
        const name = `${side}Hand${finger}${joint}`;
        add(name, [name, `${side}${finger}${joint}`, `${finger}${joint}${suffix}`]);
      }
    }
  }

  const limbEnds = new Map<string, readonly string[]>([
    ["Spine1", ["Spine2", "Chest"]], ["Spine2", ["Chest"]], ["Chest", ["Neck1", "Head"]],
    ["Neck1", ["Neck2", "Head"]], ["Neck2", ["Head"]],
  ]);
  for (const side of ["Left", "Right"]) {
    const chain = limbDefinition.map(([part]) => `${side}${part}`);
    for (const [start, end] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]]) {
      limbEnds.set(chain[start], [chain[end]]);
    }
  }

  root.updateWorldMatrix(true, true);
  const actorInverse = root.getWorldQuaternion(new Quaternion()).invert();
  const joints: JointBinding[] = [];
  root.traverse((node) => {
    if (!(node instanceof Bone)) return;
    const sourceName = sourceByBone.get(node);
    if (!sourceName) return;
    const worldRotation = node.getWorldQuaternion(new Quaternion());
    const worldPosition = node.getWorldPosition(new Vector3());
    const binding: JointBinding = { sourceName, bone: node, restInActor: actorInverse.clone().multiply(worldRotation) };
    const endName = limbEnds.get(sourceName)?.find((name) => boneBySource.has(name));
    const end = endName ? boneBySource.get(endName) : undefined;
    if (endName && end) {
      const restDirection = end.getWorldPosition(new Vector3()).sub(worldPosition).applyQuaternion(worldRotation.invert());
      if (restDirection.lengthSq() > 1e-8) binding.segment = { endName, localDirection: restDirection.normalize() };
    }
    if (sourceName.endsWith("Foot")) {
      const shin = boneBySource.get(sourceName.replace("Foot", "Shin"));
      if (shin && node.parent !== shin) binding.ankle = { shin, localPosition: shin.worldToLocal(worldPosition) };
    }
    joints.push(binding);
  });

  return { root, joints: joints.sort((a, b) => Number(Boolean(a.ankle)) - Number(Boolean(b.ankle))) };
}

/** Apply one body pose to the mapped rig. The caller supplies the actor's world position and heading. */
export function applySomaFrame(rig: SomaRig, motion: SomaMotion, frame: SomaFrame): void {
  const poses = somaJointPose(motion, frame);
  const index = new Map(motion.joints.map((name, joint) => [name, joint]));
  const pose = (name: string) => poses[index.get(name) ?? -1];
  const actorRotation = rig.root.getWorldQuaternion(new Quaternion());
  const yawInverse = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -somaHeading(frame));
  const fromSource = actorRotation.multiply(yawInverse);
  const worldRotation = new Quaternion();
  const parentInverse = new Quaternion();
  const sourceDirection = new Vector3();
  const targetDirection = new Vector3();
  const swing = new Quaternion();

  for (const { sourceName, bone, restInActor, segment, ankle } of rig.joints) {
    const joint = pose(sourceName);
    if (!joint || !bone.parent) continue;
    worldRotation.fromArray(joint.rotation).premultiply(fromSource).multiply(restInActor);
    const end = segment && pose(segment.endName);
    if (segment && end) {
      sourceDirection.fromArray(end.position).sub(targetDirection.fromArray(joint.position));
      if (sourceDirection.lengthSq() > 1e-8) {
        sourceDirection.normalize().applyQuaternion(fromSource);
        targetDirection.copy(segment.localDirection).applyQuaternion(worldRotation);
        worldRotation.premultiply(swing.setFromUnitVectors(targetDirection, sourceDirection));
      }
    }
    bone.parent.getWorldQuaternion(parentInverse).invert();
    bone.quaternion.copy(worldRotation.premultiply(parentInverse));
    if (ankle) bone.position.copy(bone.parent.worldToLocal(ankle.shin.localToWorld(sourceDirection.copy(ankle.localPosition))));
    bone.updateWorldMatrix(false, false);
  }
}
