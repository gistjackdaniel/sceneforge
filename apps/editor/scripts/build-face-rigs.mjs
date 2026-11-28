import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const source = new URL("../public/meshes/phase0/", import.meta.url);
const destination = new URL("../public/meshes/phase1/", import.meta.url);
const targetNames = [
  "jawOpen", "mouthSmileLeft", "mouthSmileRight",
  "eyeBlinkLeft", "eyeBlinkRight", "browOuterUpLeft", "browOuterUpRight",
];
const zero = [0, 0, 0];
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, bytes) => {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  const buffer = Buffer.alloc(12 + bytes.length);
  buffer.writeUInt32BE(bytes.length);
  content.copy(buffer, 4);
  buffer.writeUInt32BE(crc32(content), buffer.length - 4);
  return buffer;
};

const weaveTexture = () => {
  const size = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8);
  const rows = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const knit = (x + 2 * y) % 4 === 0 ? 21 : 0;
      const stripe = y % 16 < 2 ? 14 : 0;
      rows[y * (size + 1) + 1 + x] = 255 - knit - stripe;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const pad = (bytes, fill = 0) =>
  Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4, fill)]);

const glbChunk = (type, bytes) => {
  const chunk = Buffer.alloc(8 + bytes.length);
  chunk.writeUInt32LE(bytes.length);
  chunk.write(type, 4, "ascii");
  bytes.copy(chunk, 8);
  return chunk;
};

const makeGlb = (gltf, binary) => {
  const jsonChunk = glbChunk("JSON", pad(Buffer.from(JSON.stringify(gltf)), 0x20));
  const binChunk = glbChunk("BIN\0", pad(binary));
  const header = Buffer.alloc(12);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + jsonChunk.length + binChunk.length, 8);
  return Buffer.concat([header, jsonChunk, binChunk]);
};

const deltaFor = (material, name, [x, y, z]) => {
  if (material === "Skin" && name === "jawOpen") {
    const influence = smoothstep(2.1, 2.2, y) * (1 - smoothstep(2.31, 2.51, y)) * smoothstep(0.05, 0.42, z);
    return [0, -0.12 * influence, 0.012 * influence];
  }
  const side = name.endsWith("Left") ? 1 : -1;
  if (material !== "Face" || side * x <= 0) return zero;
  if (name.startsWith("eyeBlink") && y < 2.66) return [0, (2.555 - y) * 0.9, 0.008];
  if (name.startsWith("browOuterUp") && y > 2.66) return [0, 0.062, 0.008];
  return zero;
};

const frontAt = (vertices, indices, x, y) => {
  let front = -Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((index) => vertices[index]);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-8) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    if (u < -1e-5 || v < -1e-5 || u + v > 1 + 1e-5) continue;
    front = Math.max(front, u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  if (front < 0.3) throw new Error("Mouth does not fit the face surface.");
  return front + 0.008;
};

const convert = (path, palette) => {
  const file = readFileSync(path);
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength));
  const binary = file.subarray(28 + jsonLength);
  const buffers = [pad(binary)];
  let byteOffset = buffers[0].length;

  const addView = (bytes) => {
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    const padded = pad(bytes);
    buffers.push(padded);
    byteOffset += padded.length;
    return index;
  };
  const addAccessor = (accessor) => gltf.accessors.push(accessor) - 1;
  const write = (values, componentType, type, limits) => addAccessor({
    bufferView: addView(Buffer.from(values.buffer)),
    componentType,
    type,
    count: values.length / (type === "SCALAR" ? 1 : Number(type.slice(3))),
    ...limits,
  });
  const read = (accessorIndex, arity, ArrayType) => {
    const accessor = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[accessor.bufferView];
    const offset = binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = arity * ArrayType.BYTES_PER_ELEMENT;
    if (view.byteStride && view.byteStride !== stride) throw new Error("Expected tightly packed starter geometry.");
    return new ArrayType(binary.buffer, offset, accessor.count * arity);
  };
  const verticesOf = (primitive) => {
    const coordinates = read(primitive.attributes.POSITION, 3, Float32Array);
    return Array.from({ length: coordinates.length / 3 }, (_, i) => Array.from(coordinates.slice(3 * i, 3 * i + 3)));
  };
  const bounds = (vertices) => ({
    min: [0, 1, 2].map((axis) => Math.min(...vertices.map((value) => value[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...vertices.map((value) => value[axis]))),
  });
  const emptyTarget = new Map();
  const morphAccessor = (deltas) => {
    const indices = deltas.flatMap((delta, index) => delta.some(Boolean) ? [index] : []);
    const base = { componentType: 5126, type: "VEC3", count: deltas.length };
    if (indices.length > 0) {
      const values = Float32Array.from(indices.flatMap((index) => deltas[index]));
      return addAccessor({
        ...base,
        ...bounds(deltas),
        sparse: {
          count: indices.length,
          indices: { bufferView: addView(Buffer.from(Uint16Array.from(indices).buffer)), componentType: 5123 },
          values: { bufferView: addView(Buffer.from(values.buffer)) },
        },
      });
    }
    if (!emptyTarget.has(deltas.length)) {
      emptyTarget.set(deltas.length, addAccessor({ ...base, min: zero, max: zero }));
    }
    return emptyTarget.get(deltas.length);
  };

  const [mesh] = gltf.meshes;
  const [skin] = mesh.primitives;
  const headIndex = gltf.skins[0].joints.findIndex((node) => gltf.nodes[node].name === "Head");
  if (headIndex < 0 || gltf.materials[skin.material].name !== "Skin") throw new Error("Unexpected actor rig.");
  const skinVertices = verticesOf(skin);
  const openSkin = skinVertices.map((vertex) => {
    const delta = deltaFor("Skin", "jawOpen", vertex);
    return vertex.map((coordinate, axis) => coordinate + delta[axis]);
  });
  const skinIndices = Array.from(read(skin.indices, 1, Uint16Array));
  const texture = gltf.textures ??= [];
  const images = gltf.images ??= [];
  const samplers = gltf.samplers ??= [];
  const weave = texture.push({
    source: images.push({ bufferView: addView(weaveTexture()), mimeType: "image/png", name: "Woven fabric" }) - 1,
    sampler: samplers.push({ wrapS: 10497, wrapT: 10497 }) - 1,
  }) - 1;

  for (const primitive of mesh.primitives) {
    const material = gltf.materials[primitive.material];
    const color = palette[material.name];
    if (color) material.pbrMetallicRoughness.baseColorFactor = [...color, 1];
    const vertices = verticesOf(primitive);
    primitive.targets = targetNames.map((name) => ({
      POSITION: morphAccessor(vertices.map((vertex) => deltaFor(material.name, name, vertex))),
    }));
    if (material.name === "Shirt") {
      const uv = vertices.flatMap(([x, y, z]) => [2 * (Math.atan2(x, z) / (2 * Math.PI) + 0.5), 3 * y]);
      primitive.attributes.TEXCOORD_0 = write(Float32Array.from(uv), 5126, "VEC2");
      material.pbrMetallicRoughness.baseColorTexture = { index: weave };
    }
  }

  const mouthShape = (name) => Array.from({ length: 17 }, (_, column) => {
    const u = column / 8 - 1;
    const onSmileSide = name === "mouthSmileLeft" ? u > 0 : name === "mouthSmileRight" && u < 0;
    const smile = onSmileSide ? Math.abs(u) : 0;
    const x = u * 0.144 + Math.sign(u) * 0.058 * smile;
    const arc = 2.364 + 0.019 * u * u + 0.064 * smile ** 1.8;
    const spread = Math.sqrt(1 - u * u);
    const opening = name === "jawOpen";
    return [arc + 0.008 * spread, arc - (opening ? 0.135 : 0.008) * spread].map((y) => [
      x, y, frontAt(opening ? openSkin : skinVertices, skinIndices, x, y),
    ]);
  }).flat();
  const mouth = mouthShape("rest");
  const mouthIndices = Array.from({ length: 16 }, (_, i) => [
    i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2,
  ]).flat();
  const count = mouth.length;
  const mouthMaterial = gltf.materials.push({
    name: "Lips and mouth",
    doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [0.095, 0.024, 0.026, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  }) - 1;
  mesh.primitives.push({
    attributes: {
      POSITION: write(Float32Array.from(mouth.flat()), 5126, "VEC3", bounds(mouth)),
      NORMAL: write(Float32Array.from(Array.from({ length: count }, () => [0, 0, 1]).flat()), 5126, "VEC3"),
      JOINTS_0: write(Uint16Array.from(Array.from({ length: count }, () => [headIndex, 0, 0, 0]).flat()), 5123, "VEC4"),
      WEIGHTS_0: write(Float32Array.from(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()), 5126, "VEC4"),
    },
    indices: write(Uint16Array.from(mouthIndices), 5123, "SCALAR"),
    material: mouthMaterial,
    targets: targetNames.map((name) => ({
      POSITION: morphAccessor(name.startsWith("eye") || name.startsWith("brow")
        ? mouth.map(() => zero)
        : mouthShape(name).map((vertex, index) => vertex.map((value, axis) => value - mouth[index][axis]))),
    })),
  });
  mesh.extras = { ...mesh.extras, targetNames };
  mesh.weights = targetNames.map(() => 0);
  gltf.buffers[0].byteLength = byteOffset;
  return makeGlb(gltf, Buffer.concat(buffers));
};

mkdirSync(destination, { recursive: true });
const palettes = {
  "actor-a.glb": { Skin: [0.36, 0.19, 0.12], Shirt: [0.025, 0.22, 0.19], Hair: [0.046, 0.026, 0.016], Pants: [0.055, 0.083, 0.11], Face: [0.07, 0.038, 0.025] },
  "actor-b.glb": { Skin: [0.56, 0.30, 0.19], Shirt: [0.45, 0.11, 0.045], Hair: [0.11, 0.041, 0.016], Pants: [0.082, 0.068, 0.052], Face: [0.08, 0.043, 0.026] },
};
for (const [actor, palette] of Object.entries(palettes)) {
  writeFileSync(new URL(actor, destination), convert(new URL(actor, source), palette));
}
