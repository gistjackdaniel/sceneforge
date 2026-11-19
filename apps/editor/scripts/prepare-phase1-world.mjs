import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workDir = new URL("../../../.local/phase1-world/", import.meta.url);
const require = createRequire(new URL("package.json", workDir));
const sharp = createRequire(require.resolve("ndarray-pixels"))("sharp");
const { getBounds, NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS, EXTTextureWebP } = require("@gltf-transform/extensions");
const { dedup, prune, simplify, weld } = require("@gltf-transform/functions");
const { MeshoptSimplifier } = require("meshoptimizer");

const sourcePath = fileURLToPath(new URL("classroom2.glb", workDir));
const targetPath = fileURLToPath(new URL("../public/worlds/phase1-classroom/room.glb", import.meta.url));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const source = await readFile(sourcePath);
if (sha256(source) !== "8e94a4abbc061f7453fc535bc6feaaaecc9b2797b33d5b62a9bd2b598a5208dc") {
  throw new Error("Unexpected upstream Classroom GLB. Check CREDITS.txt for the pinned source.");
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.readBinary(source);
const groups = new Map();
for (const node of document.getRoot().listNodes()) {
  const group = /^((?:chair|leatherChair)(?:\.\d+)?)__/.exec(node.getName())?.[1];
  if (!group) continue;
  const nodes = groups.get(group) ?? [];
  nodes.push(node);
  groups.set(group, nodes);
}

const overlapsStage = ({ min, max }) => min[0] <= 2.5 && max[0] >= 0.45 && min[2] <= 3.6 && max[2] >= -1.05;
for (const nodes of groups.values()) {
  if (nodes.some((node) => overlapsStage(getBounds(node)))) {
    for (const node of nodes) node.dispose();
  }
}

for (const node of document.getRoot().listNodes()) {
  node.getExtension("KHR_lights_punctual")?.setIntensity(2.5);
  if (node.getCamera()) node.dispose();
}

await MeshoptSimplifier.ready;
await document.transform(
  dedup(),
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.001, lockBorder: true }),
);
for (const texture of document.getRoot().listTextures()) {
  const image = await sharp(Buffer.from(texture.getImage()))
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .webp({ quality: 86 })
    .toBuffer();
  texture.setImage(image).setMimeType("image/webp");
}
document.createExtension(EXTTextureWebP).setRequired(true);
await io.write(targetPath, document);

const result = await readFile(targetPath);
console.log(JSON.stringify({ targetPath, contentHash: sha256(result), byteLength: result.length }));
