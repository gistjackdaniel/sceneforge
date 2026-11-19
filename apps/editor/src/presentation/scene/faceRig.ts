import type { Mesh, Object3D } from "three";

const pairedChannels = [
  "browDown", "browOuterUp", "cheekSquint", "eyeBlink", "eyeLookDown", "eyeLookIn",
  "eyeLookOut", "eyeLookUp", "eyeSquint", "eyeWide", "mouthDimple", "mouthFrown",
  "mouthLowerDown", "mouthPress", "mouthSmile", "mouthStretch", "mouthUpperUp", "noseSneer",
];
const channels = [
  "browInnerUp", "cheekPuff", "jawForward", "jawLeft", "jawOpen", "jawRight", "mouthClose",
  "mouthFunnel", "mouthLeft", "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper", "tongueOut",
  ...pairedChannels.flatMap((name) => [`${name}Left`, `${name}Right`]),
];
const normalizeName = (name: string) =>
  name.replace(/^.*[.:|]/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const names = new Map(channels.map((channel) => [normalizeName(channel), channel]));

export interface LiveFaceFrame {
  subjectId: string;
  weights: Readonly<Record<string, number>>;
}

interface FaceBinding {
  weights: number[];
  index: number;
  channel: string;
  restWeight: number;
}

/** Read supported facial weights from the external detector. */
export const readFaceWeights = (
  categories: readonly { categoryName: string; score: number }[],
): LiveFaceFrame["weights"] => {
  const weights: Record<string, number> = {};
  for (const { categoryName, score } of categories) {
    const channel = names.get(normalizeName(categoryName));
    if (channel && Number.isFinite(score)) weights[channel] = Math.max(0, Math.min(1, score));
  }
  return weights;
};

/** Bind each ARKit-compatible target once, preserving the rig's original influence for restoration. */
export const bindFaceRig = (root: Object3D): FaceBinding[] => {
  const bindings: FaceBinding[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    const { morphTargetDictionary, morphTargetInfluences: weights } = mesh;
    if (!mesh.isMesh || !morphTargetDictionary || !weights) return;
    for (const [name, index] of Object.entries(morphTargetDictionary)) {
      const channel = names.get(normalizeName(name));
      if (channel && Number.isFinite(weights[index])) {
        bindings.push({ channel, weights, index, restWeight: weights[index] });
      }
    }
  });
  return bindings;
};

/** Apply the active subject's expression on top of skeletal motion. Restore captured weights when idle. */
export const applyLiveFace = (
  bindings: readonly FaceBinding[],
  subjectId: string,
  frame: LiveFaceFrame | null,
): void => {
  const weights = frame?.subjectId === subjectId ? frame.weights : undefined;
  for (const binding of bindings) {
    binding.weights[binding.index] = weights?.[binding.channel] ?? binding.restWeight;
  }
};
