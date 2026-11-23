import { z } from "zod";
import { geometrySha256, readGeometry, writeGeometry } from "../../infrastructure/persistence/geometryStore";
import {
  importedShotWorldSchema, importedWorldHash, importedWorldUri, SHOT_WORLD_MAX_BYTES,
  type ImportedShotWorld,
} from "../../domain/worlds/importedShotWorld";

const index = z.number().int().nonnegative();
const view = z.object({ buffer: z.literal(0), byteLength: index, byteOffset: index.default(0) });
const texture = z.object({ index });
const material = z.object({
  pbrMetallicRoughness: z.object({ baseColorTexture: texture.optional(), metallicRoughnessTexture: texture.optional() }).optional(),
  normalTexture: texture.optional(),
  occlusionTexture: texture.optional(),
  emissiveTexture: texture.optional(),
});
const gltfScene = z.object({
  asset: z.object({ version: z.literal("2.0") }),
  buffers: z.tuple([z.object({ byteLength: index, uri: z.undefined().optional() })]),
  bufferViews: z.array(view).nonempty(),
  accessors: z.array(z.object({ count: z.number().int().positive(), type: z.string(), bufferView: index.optional() })).nonempty(),
  meshes: z.array(z.object({ primitives: z.array(z.object({ attributes: z.object({ POSITION: index }) })).nonempty() })).nonempty(),
  images: z.array(z.object({
    bufferView: index,
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    uri: z.undefined().optional(),
  })).default([]),
  materials: z.array(material).default([]),
  extensionsRequired: z.array(z.string()).default([]),
});

const unsupportedCompression = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]);
const invalidGlb = () => new Error("외부 파일을 참조하지 않는 glTF 2.0 GLB 메시를 선택하세요.");

/** Read the geometry and material inventory from a bounded, self-contained GLB. */
export const inspectShotWorldGlb = (bytes: ArrayBuffer): Pick<ImportedShotWorld, "meshCount" | "texturedMaterialCount"> => {
  if (bytes.byteLength > SHOT_WORLD_MAX_BYTES) throw new Error("씬 GLB는 128 MiB 이하여야 합니다.");
  if (bytes.byteLength < 28) throw invalidGlb();
  const header = new DataView(bytes);
  const jsonLength = header.getUint32(12, true);
  const binaryOffset = 20 + jsonLength;
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
    || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a
    || jsonLength % 4 !== 0 || binaryOffset + 8 > bytes.byteLength) throw invalidGlb();
  const binaryLength = header.getUint32(binaryOffset, true);
  if (header.getUint32(binaryOffset + 4, true) !== 0x004e4942 || binaryOffset + 8 + binaryLength !== bytes.byteLength) {
    throw invalidGlb();
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength)));
  } catch {
    throw invalidGlb();
  }
  const parsed = gltfScene.safeParse(json);
  if (!parsed.success) throw invalidGlb();
  const gltf = parsed.data;
  if (gltf.extensionsRequired.some((extension) => unsupportedCompression.has(extension))) {
    throw new Error("Draco, Meshopt, BasisU 압축을 해제한 씬 GLB를 선택하세요.");
  }
  const length = gltf.buffers[0].byteLength;
  if (length === 0 || length > binaryLength || binaryLength - length > 3
    || gltf.bufferViews.some((item) => item.byteOffset + item.byteLength > length)
    || gltf.images.some((image) => !gltf.bufferViews[image.bufferView])) throw invalidGlb();
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = gltf.accessors[primitive.attributes.POSITION];
      if (positions?.type !== "VEC3" || positions.bufferView === undefined || !gltf.bufferViews[positions.bufferView]) {
        throw invalidGlb();
      }
    }
  }
  const texturedMaterialCount = gltf.materials.filter((item) => item.pbrMetallicRoughness?.baseColorTexture
    || item.pbrMetallicRoughness?.metallicRoughnessTexture || item.normalTexture || item.occlusionTexture || item.emissiveTexture).length;
  return { meshCount: gltf.meshes.length, texturedMaterialCount };
};

const downloadGlb = async (source: string, signal?: AbortSignal): Promise<Blob> => {
  const url = new URL(source, document.baseURI);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("HTTP 또는 HTTPS 씬 주소를 사용하세요.");
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("주소에서 씬 GLB를 불러올 수 없습니다.");
  if (Number(response.headers.get("Content-Length")) > SHOT_WORLD_MAX_BYTES) {
    throw new Error("씬 GLB는 128 MiB 이하여야 합니다.");
  }
  return response.blob();
};

/** Persist GLB bytes by hash outside Project JSON and return serializable revision metadata. */
export const importShotWorld = async (
  source: Blob | string,
  options: { name: string; signal?: AbortSignal },
): Promise<ImportedShotWorld> => {
  const { name, signal } = options;
  signal?.throwIfAborted();
  const blob = typeof source === "string" ? await downloadGlb(source, signal) : source;
  if (blob.size > SHOT_WORLD_MAX_BYTES) throw new Error("씬 GLB는 128 MiB 이하여야 합니다.");
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  const geometry = inspectShotWorldGlb(bytes);
  const contentHash = await geometrySha256(bytes);
  const imported = importedShotWorldSchema.parse({
    name, uri: importedWorldUri(contentHash), contentHash, byteLength: bytes.byteLength, ...geometry,
  });
  signal?.throwIfAborted();
  await writeGeometry(contentHash, bytes);
  signal?.throwIfAborted();
  return imported;
};

/** Return stored GLB bytes for an imported revision. Bundled or external URIs return undefined. */
export const readImportedShotWorld = async (uri: string): Promise<ArrayBuffer | undefined> => {
  const hash = importedWorldHash(uri);
  if (!hash) return undefined;
  return readGeometry(hash);
};
