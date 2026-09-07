/**
 * Builds distinctive viewport fixtures: solid mesh, discrete points, gaussian splats.
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Blob } from "node:buffer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

globalThis.Blob = Blob;
globalThis.FileReader = class FileReader {
  result = null;
  onload = null;
  onloadend = null;
  onerror = null;
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      })
      .catch((error) => this.onerror?.(error));
  }
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/worlds/color_block_room");
const apartmentGlb = join(root, "public/worlds/apartment_livingroom/preview.glb");

const COLORS = {
  floor: 0xe23d28,
  back: 0x00e676,
  left: 0xd500f9,
  right: 0x00e5ff,
  cube: 0xff9100,
  sphere: 0x2979ff,
  cone: 0xf5f5f5,
};

const addBox = (parent, { color, w, h, d, x, y, z }) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
};

const buildMeshScene = () => {
  const rootGroup = new THREE.Group();
  rootGroup.name = "color-block-room";
  addBox(rootGroup, { color: COLORS.floor, w: 3.2, h: 0.06, d: 3.2, x: 0, y: -0.03, z: 0 });
  addBox(rootGroup, { color: COLORS.back, w: 3.2, h: 2.2, d: 0.08, x: 0, y: 1.1, z: -1.56 });
  addBox(rootGroup, { color: COLORS.left, w: 0.08, h: 2.2, d: 3.2, x: -1.56, y: 1.1, z: 0 });
  addBox(rootGroup, { color: COLORS.right, w: 0.08, h: 2.2, d: 3.2, x: 1.56, y: 1.1, z: 0 });
  addBox(rootGroup, { color: COLORS.cube, w: 0.5, h: 0.5, d: 0.5, x: -0.7, y: 0.25, z: 0.35 });
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshStandardMaterial({ color: COLORS.sphere, roughness: 0.35, metalness: 0.1 }),
  );
  sphere.position.set(0.75, 0.28, 0.25);
  rootGroup.add(sphere);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.7, 20),
    new THREE.MeshStandardMaterial({ color: COLORS.cone, roughness: 0.45, metalness: 0.05 }),
  );
  cone.position.set(0.05, 0.35, -0.55);
  rootGroup.add(cone);
  return rootGroup;
};

const hexRgb = (hex) => {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
};

const sampleBoxPoints = (center, size, color, count, points) => {
  for (let i = 0; i < count; i += 1) {
    const face = i % 6;
    const u = Math.random() - 0.5;
    const v = Math.random() - 0.5;
    let x = center[0];
    let y = center[1];
    let z = center[2];
    if (face === 0) {
      x += size[0] / 2;
      y += u * size[1];
      z += v * size[2];
    } else if (face === 1) {
      x -= size[0] / 2;
      y += u * size[1];
      z += v * size[2];
    } else if (face === 2) {
      y += size[1] / 2;
      x += u * size[0];
      z += v * size[2];
    } else if (face === 3) {
      y -= size[1] / 2;
      x += u * size[0];
      z += v * size[2];
    } else if (face === 4) {
      z += size[2] / 2;
      x += u * size[0];
      y += v * size[1];
    } else {
      z -= size[2] / 2;
      x += u * size[0];
      y += v * size[1];
    }
    points.push({ x, y, z, r: color[0], g: color[1], b: color[2] });
  }
};

const sampleSpherePoints = (center, radius, color, count, points) => {
  for (let i = 0; i < count; i += 1) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    points.push({
      x: center[0] + radius * Math.sin(phi) * Math.cos(theta),
      y: center[1] + radius * Math.cos(phi),
      z: center[2] + radius * Math.sin(phi) * Math.sin(theta),
      r: color[0],
      g: color[1],
      b: color[2],
    });
  }
};

const writeAsciiPly = (points, extraHeader, extraValues) => {
  const header = [
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    ...(extraHeader ?? []),
    "end_header",
  ];
  const lines = points.map((point, index) => {
    const rgb = [
      Math.round(point.r * 255),
      Math.round(point.g * 255),
      Math.round(point.b * 255),
    ].join(" ");
    const extra = extraValues ? ` ${extraValues(point, index)}` : "";
    return `${point.x.toFixed(5)} ${point.y.toFixed(5)} ${point.z.toFixed(5)} ${rgb}${extra}`;
  });
  return `${header.join("\n")}\n${lines.join("\n")}\n`;
};

const SH_C0 = 0.28209479177387814;
const logit = (value) => Math.log(value / (1 - value));
const logScale = (value) => Math.log(value);

const splatExtraHeader = [
  "property float f_dc_0",
  "property float f_dc_1",
  "property float f_dc_2",
  "property float opacity",
  "property float scale_0",
  "property float scale_1",
  "property float scale_2",
  "property float rot_0",
  "property float rot_1",
  "property float rot_2",
  "property float rot_3",
];

const splatValues = (point) => {
  const dc0 = ((point.r - 0.5) / SH_C0).toFixed(5);
  const dc1 = ((point.g - 0.5) / SH_C0).toFixed(5);
  const dc2 = ((point.b - 0.5) / SH_C0).toFixed(5);
  const opacity = logit(0.82).toFixed(5);
  const scale = logScale(point.splatScale ?? 0.08).toFixed(5);
  return `${dc0} ${dc1} ${dc2} ${opacity} ${scale} ${scale} ${scale} 1 0 0 0`;
};

const buildPointCloud = () => {
  const points = [];
  sampleBoxPoints([0, -0.03, 0], [3.2, 0.06, 3.2], hexRgb(COLORS.floor), 1800, points);
  sampleBoxPoints([0, 1.1, -1.56], [3.2, 2.2, 0.08], hexRgb(COLORS.back), 1400, points);
  sampleBoxPoints([-1.56, 1.1, 0], [0.08, 2.2, 3.2], hexRgb(COLORS.left), 1400, points);
  sampleBoxPoints([1.56, 1.1, 0], [0.08, 2.2, 3.2], hexRgb(COLORS.right), 1400, points);
  sampleBoxPoints([-0.7, 0.25, 0.35], [0.5, 0.5, 0.5], hexRgb(COLORS.cube), 500, points);
  sampleSpherePoints([0.75, 0.28, 0.25], 0.28, hexRgb(COLORS.sphere), 500, points);
  sampleSpherePoints([0.05, 0.35, -0.55], 0.28, hexRgb(COLORS.cone), 400, points);
  return points;
};

const buildSplats = () => {
  const splats = [];
  const push = (x, y, z, hex, splatScale) => {
    const [r, g, b] = hexRgb(hex);
    splats.push({ x, y, z, r, g, b, splatScale });
  };
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      push(i * 0.32, 0.02, j * 0.32, COLORS.floor, 0.11);
    }
  }
  for (let i = -4; i <= 4; i += 1) {
    for (let j = 0; j <= 6; j += 1) {
      push(i * 0.32, 0.18 + j * 0.28, -1.52, COLORS.back, 0.12);
      push(-1.52, 0.18 + j * 0.28, i * 0.32, COLORS.left, 0.12);
      push(1.52, 0.18 + j * 0.28, i * 0.32, COLORS.right, 0.12);
    }
  }
  push(-0.7, 0.25, 0.35, COLORS.cube, 0.28);
  push(-0.55, 0.4, 0.2, COLORS.cube, 0.16);
  push(0.75, 0.28, 0.25, COLORS.sphere, 0.3);
  push(0.05, 0.35, -0.55, COLORS.cone, 0.26);
  push(0.05, 0.62, -0.55, COLORS.cone, 0.16);
  return splats;
};

const exportGlb = async (object) => {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  return Buffer.from(result);
};

mkdirSync(outDir, { recursive: true });
const mesh = buildMeshScene();
const glb = await exportGlb(mesh);
writeFileSync(join(outDir, "mesh.glb"), glb);
copyFileSync(join(outDir, "mesh.glb"), apartmentGlb);
writeFileSync(join(outDir, "points.ply"), writeAsciiPly(buildPointCloud()));
writeFileSync(join(outDir, "splats.ply"), writeAsciiPly(buildSplats(), splatExtraHeader, splatValues));
console.log(`Wrote fixtures to ${outDir} (${glb.length} byte glb)`);
