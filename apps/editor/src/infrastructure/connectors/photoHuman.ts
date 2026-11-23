import { fitSelfie, HumanAvatar, loadHumanPackage, type HumanPackage } from "humanforge/human";
import { MeshStandardMaterial, SkinnedMesh, Texture } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createFaceDetector } from "../../presentation/scene/faceDetector";
import { preparePhotoHumanExpressions } from "./photoHumanMorphs";
import { projectFaceTexture } from "./photoHumanTexture";

const ASSET_ROOT = "https://cdn.jsdelivr.net/gh/abdulrehman043/humanforge@2226df1f50a04c5a8e1c02ea33780d28337dfbb1/assets/human";

// HumanForge does not estimate gender from landmarks, so the body comes from the user's choice.
const BODIES = {
  male: { gender: 1, hair: "short02", clothes: ["male_casualsuit01", "shoes01"] },
  female: { gender: 0, hair: "bob02", clothes: ["female_casualsuit01", "shoes01"] },
} as const;
export type PhotoBody = keyof typeof BODIES;
const MAX_IMAGE_SIDE = 1536;

async function decodePhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("이미지를 읽을 수 없습니다. JPG, PNG 또는 WebP 이미지를 선택해 주세요.");
  });
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("이미지 처리에 필요한 Canvas를 사용할 수 없습니다.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
  } finally {
    bitmap.close();
  }
}

async function findFace(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const detector = await createFaceDetector(signal);
  try {
    await detector.setOptions({ runningMode: "IMAGE", numFaces: 2, outputFaceBlendshapes: false });
    signal.throwIfAborted();
    const { faceLandmarks } = detector.detect(canvas);
    if (faceLandmarks.length !== 1 || faceLandmarks[0].length < 468) {
      throw new Error("얼굴이 선명하게 나온 한 사람의 정면 사진을 선택해 주세요.");
    }
    const points = faceLandmarks[0];
    const faceHeight = Math.abs(points[152].y - points[10].y) * canvas.height;
    if (faceHeight < 55 || [10, 152, 234, 454].some((index) => {
      const { x, y } = points[index];
      return x <= 0 || x >= 1 || y <= 0 || y >= 1;
    })) {
      throw new Error("얼굴 전체가 프레임에 들어오고 더 크게 보이는 정면 사진을 선택해 주세요.");
    }
    return points;
  } finally {
    detector.close();
  }
}

const disposeTextures = async (pkg: HumanPackage) => {
  for (const entry of await Promise.allSettled(pkg.textureCache.values())) {
    if (entry.status === "fulfilled") {
      entry.value.dispose();
      if (entry.value.image instanceof ImageBitmap) entry.value.image.close();
    }
  }
};

export async function generatePhotoHuman(file: File, build: PhotoBody, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const { canvas, pixels } = await decodePhoto(file);
  signal.throwIfAborted();
  const landmarks = await findFace(canvas, signal);
  const fetchAsset = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`인물 모델 파일을 불러올 수 없습니다 (HTTP ${response.status}).`);
    return response;
  };
  const pkg = await loadHumanPackage(import.meta.env.VITE_PHOTO_HUMAN_ASSET_URL || ASSET_ROOT, {
    fetch: async (url) => (await fetchAsset(url)).arrayBuffer(),
    loadTexture: async (url) => new Texture(await createImageBitmap(await (await fetchAsset(url)).blob())),
  });
  signal.throwIfAborted();

  const avatar = new HumanAvatar(pkg);
  let generatedTexture: Texture | undefined;
  try {
    const { gender, hair, clothes } = BODIES[build];
    const { config } = fitSelfie(pkg, landmarks, canvas, pixels, { hints: { gender } });
    await avatar.setConfig({ ...config, hair, clothes: [...clothes] });
    signal.throwIfAborted();

    const body = avatar.group.getObjectByName("body");
    if (!(body instanceof SkinnedMesh) || !(body.material instanceof MeshStandardMaterial) || !body.material.map) {
      throw new Error("인물 모델에서 스킨을 찾을 수 없습니다.");
    }
    generatedTexture = projectFaceTexture(canvas, landmarks, body.material, body.geometry, pkg.body.attributes._MH.array);
    body.material.map = generatedTexture;
    body.material.color.set(0xffffff);

    preparePhotoHumanExpressions(avatar.group);
    avatar.group.traverse((object) => {
      if (object.userData.softPass) object.visible = false;
      if (!(object instanceof SkinnedMesh) || !(object.material instanceof MeshStandardMaterial)) return;
      const { map, normalMap } = object.material;
      if (map) map.userData.mimeType = object.material.alphaTest > 0 || object.material.transparent ? "image/png" : "image/jpeg";
      if (normalMap) normalMap.userData.mimeType = "image/jpeg";
    });
    const result = await new GLTFExporter().parseAsync(avatar.group, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
    signal.throwIfAborted();
    if (!(result instanceof ArrayBuffer)) throw new Error("인물 GLB를 만들 수 없습니다.");
    return result;
  } finally {
    generatedTexture?.dispose();
    avatar.dispose();
    await disposeTextures(pkg);
  }
}
