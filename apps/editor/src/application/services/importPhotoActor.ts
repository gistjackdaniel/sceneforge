import { Box3, MeshStandardMaterial, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { importedActorUri } from "../../domain/worlds/photoActor";
import type { SceneObject } from "../../domain/worlds/sceneObjects";
import { geometrySha256, writeGeometry } from "../../infrastructure/persistence/geometryStore";
import { disposeMeshResources } from "../../infrastructure/renderers/disposeMeshResources";
import { bindFaceRig } from "../../presentation/scene/faceRig";
import { bindSomaRig } from "../../presentation/scene/somaRetarget";
import { inspectShotWorldGlb } from "./importShotWorld";

const bodyJoints = ["Hips", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm", "LeftLeg", "LeftShin", "RightLeg", "RightShin"];
const faceChannels = ["jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft", "mouthSmileRight"];

export async function importPhotoActor(bytes: ArrayBuffer, name: string, signal: AbortSignal): Promise<SceneObject> {
  signal.throwIfAborted();
  inspectShotWorldGlb(bytes);
  const { scene } = await new GLTFLoader().parseAsync(bytes, "");
  const bounds = new Box3();
  try {
    signal.throwIfAborted();
    let texturedSkin = false;
    scene.traverse((node) => {
      if (!(node instanceof SkinnedMesh) || !node.geometry.hasAttribute("skinIndex") || !node.geometry.hasAttribute("skinWeight")) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      texturedSkin ||= materials.some((material) => material instanceof MeshStandardMaterial && Boolean(material.map));
    });
    const joints = new Set(bindSomaRig(scene).joints.map((joint) => joint.sourceName));
    const channels = new Set(bindFaceRig(scene).map((binding) => binding.channel));
    if (!texturedSkin || !bodyJoints.every((joint) => joints.has(joint)) || !faceChannels.every((channel) => channels.has(channel))) {
      throw new Error("텍스처, Kimodo 전신 관절, 웹캠 표정 모프를 갖춘 사람 GLB를 만들지 못했습니다.");
    }
    bounds.setFromObject(scene);
  } finally {
    disposeMeshResources(scene);
  }
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error("사람 메시의 높이를 계산할 수 없습니다.");
  const scale = 1.72 / height;
  const hash = await geometrySha256(bytes);
  signal.throwIfAborted();
  await writeGeometry(hash, bytes);
  signal.throwIfAborted();
  return {
    id: `actor-${crypto.randomUUID()}`, name, kind: "actor", representation: "mesh", uri: importedActorUri(hash),
    position: [0, -bounds.min.y * scale, 0], rotation: [0, 0, 0], scale: [scale, scale, scale],
    visible: true, locked: false, color: "#d8d2c4", intensity: 3,
  };
}
