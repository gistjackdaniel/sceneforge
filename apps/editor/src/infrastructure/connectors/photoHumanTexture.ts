import { FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { CanvasTexture, type BufferGeometry, type MeshStandardMaterial } from "three";
import { FACE_VERTICES } from "./photoHumanFaceMap";

type Point = { x: number; y: number };
type Triangle = [Point, Point, Point];

function makeLayer(size: number, height = size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 처리에 필요한 Canvas를 사용할 수 없습니다.");
  return { canvas, context };
}

function path(context: CanvasRenderingContext2D, points: Point[]) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function paintTriangle(
  context: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  source: Triangle,
  target: Triangle,
) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y;
  const sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
  const tx1 = t1.x - t0.x, ty1 = t1.y - t0.y;
  const tx2 = t2.x - t0.x, ty2 = t2.y - t0.y;
  const determinant = sx1 * sy2 - sx2 * sy1;
  const targetArea = tx1 * ty2 - tx2 * ty1;
  if (Math.abs(determinant) < 0.1 || Math.abs(targetArea) < 0.1) return;
  if (Math.max(Math.abs(tx1), Math.abs(ty1), Math.abs(tx2), Math.abs(ty2)) > context.canvas.width * 0.1) return;
  const a = (tx1 * sy2 - tx2 * sy1) / determinant;
  const b = (ty1 * sy2 - ty2 * sy1) / determinant;
  const c = (tx2 * sx1 - tx1 * sx2) / determinant;
  const d = (ty2 * sx1 - ty1 * sx2) / determinant;
  const center = { x: (t0.x + t1.x + t2.x) / 3, y: (t0.y + t1.y + t2.y) / 3 };
  const clip = target.map(({ x, y }) => {
    const dx = x - center.x, dy = y - center.y;
    const scale = 0.75 / Math.max(1, Math.hypot(dx, dy));
    return { x: x + dx * scale, y: y + dy * scale };
  });
  context.save();
  path(context, clip);
  context.clip();
  context.setTransform(a, b, c, d, t0.x - a * s0.x - c * s0.y, t0.y - b * s0.x - d * s0.y);
  context.drawImage(photo, 0, 0);
  context.restore();
}

// Photo lighting rarely matches the body skin, which leaves a visible mask edge.
// Scale the face so its feathered border has the same mean color as the skin under it.
function matchSkinTone(face: CanvasRenderingContext2D, skin: CanvasRenderingContext2D) {
  const { width, height } = face.canvas;
  const photo = face.getImageData(0, 0, width, height);
  const base = skin.getImageData(0, 0, width, height).data;
  const sums = [0, 0, 0, 0, 0, 0];
  for (let index = 0; index < photo.data.length; index += 4) {
    const alpha = photo.data[index + 3];
    if (alpha < 128 || alpha > 250) continue;
    for (let channel = 0; channel < 3; channel++) {
      sums[channel] += photo.data[index + channel];
      sums[channel + 3] += base[index + channel];
    }
  }
  if (sums.slice(0, 3).some((sum) => sum === 0)) return;
  const gains = [0, 1, 2].map((channel) => sums[channel + 3] / sums[channel]);
  for (let index = 0; index < photo.data.length; index += 4) {
    if (photo.data[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) photo.data[index + channel] *= gains[channel];
  }
  face.putImageData(photo, 0, 0);
}

export function projectFaceTexture(
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  material: MeshStandardMaterial,
  geometry: BufferGeometry,
  sourceVertices: ArrayLike<number>,
): CanvasTexture {
  const skin = material.map;
  const image = skin?.image;
  if (!skin || !(image instanceof ImageBitmap)) throw new Error("인물 모델에서 피부 텍스처를 찾을 수 없습니다.");
  const { width, height } = image;
  const uv = geometry.getAttribute("uv");
  const uvByVertex = new Map<number, Point>();
  for (let index = 0; index < uv.count; index++) {
    const vertex = sourceVertices[index];
    if (uvByVertex.has(vertex)) continue;
    uvByVertex.set(vertex, { x: uv.getX(index) * width, y: (skin.flipY ? 1 - uv.getY(index) : uv.getY(index)) * height });
  }
  const target = FACE_VERTICES.map((vertex) => uvByVertex.get(vertex));
  if (target.some((point) => !point)) throw new Error("사진을 맞출 얼굴 메시 영역을 찾을 수 없습니다.");
  const coordinates = target as Point[];
  const source = landmarks.map((point) => ({ x: point.x * photo.width, y: point.y * photo.height }));
  const overlay = makeLayer(width, height);
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  for (let index = 0; index < edges.length; index += 3) {
    const { start: a, end: b } = edges[index];
    const { end: c } = edges[index + 1];
    paintTriangle(overlay.context, photo, [source[a], source[b], source[c]], [coordinates[a], coordinates[b], coordinates[c]]);
  }

  const outline = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(({ start }) => coordinates[start]);
  const center = coordinates[1];
  const inset = outline.map(({ x, y }) => ({ x: center.x + (x - center.x) * 0.91, y: center.y + (y - center.y) * 0.91 }));
  const mask = makeLayer(width, height);
  mask.context.filter = `blur(${Math.max(width, height) / 320}px)`;
  path(mask.context, inset);
  mask.context.fill();
  overlay.context.globalCompositeOperation = "destination-in";
  overlay.context.drawImage(mask.canvas, 0, 0);

  const combined = makeLayer(width, height);
  combined.context.drawImage(image, 0, 0);
  combined.context.globalCompositeOperation = "multiply";
  combined.context.fillStyle = `#${material.color.getHexString()}`;
  combined.context.fillRect(0, 0, width, height);
  combined.context.globalCompositeOperation = "source-over";
  matchSkinTone(overlay.context, combined.context);
  combined.context.drawImage(overlay.canvas, 0, 0);

  const texture = new CanvasTexture(combined.canvas);
  texture.colorSpace = skin.colorSpace;
  texture.flipY = skin.flipY;
  return texture;
}
