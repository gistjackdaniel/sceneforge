import { RENDER_PASS_FORMAT, RENDER_PASS_KINDS, shotPassSpec } from "../../domain/render/types";
import { RenderPassRenderer } from "../../domain/render/RenderPassRenderer";
import { selectedTake } from "../../domain/shot";
import type { Shot } from "../../domain/shot";

const BLOCK = 512;
const encoder = new TextEncoder();
const nativeLittleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

function bytes(data: Uint8Array | Float32Array | Uint32Array): Uint8Array<ArrayBuffer> {
  if (nativeLittleEndian || data instanceof Uint8Array) {
    const { buffer, byteOffset, byteLength } = data;
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer, byteOffset, byteLength);
    return new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength));
  }
  const result = new Uint8Array(data.byteLength);
  const view = new DataView(result.buffer);
  for (let index = 0; index < data.length; index++) {
    if (data instanceof Float32Array) view.setFloat32(index * 4, data[index], true);
    else view.setUint32(index * 4, data[index], true);
  }
  return result;
}

function addFile(parts: BlobPart[], name: string, data: Uint8Array<ArrayBuffer>[]) {
  const size = data.reduce((total, chunk) => total + chunk.byteLength, 0);
  const header = new Uint8Array(BLOCK);
  const write = (offset: number, value: string) => header.set(encoder.encode(value), offset);
  write(0, name);
  write(100, "0000644");
  write(108, "0000000");
  write(116, "0000000");
  write(124, size.toString(8).padStart(11, "0"));
  write(136, "00000000000");
  write(148, "        ");
  write(156, "0");
  write(257, "ustar\0" + "00");
  write(148, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ");
  parts.push(header, ...data, new Uint8Array((BLOCK - size % BLOCK) % BLOCK));
}

export function createShotPassArchive(shot: Shot, aspect: number): Blob {
  const take = selectedTake(shot);
  if (!take) throw new Error("Select a camera take to export render passes.");
  const spec = shotPassSpec(aspect);
  const result = RenderPassRenderer.render(shot, {
    spec,
    frameRange: { start: 0, end: shot.time.durationFrames - 1 },
    assetRevision: { assetId: shot.environment?.worldId ?? shot.id, revisionId: shot.environment?.revisionId ?? "shot-record" },
    seed: 0,
    includeSurfaceTracking: true,
  });
  if (!result.ok) throw new Error(result.reason);
  const { frames, trajectory, table, hashes, assetRevision, frameRange, fps, cameraId, rendererVersion } = result.output;
  const parts: BlobPart[] = [];
  const json = (name: string, value: unknown) => addFile(parts, name, [encoder.encode(JSON.stringify(value))]);
  json("manifest.json", {
    formatVersion: 1, rendererVersion, geometry: "reference-proxies", spec, fps, frameRange, cameraId, assetRevision,
    byteOrder: "little-endian", layout: "frame-row-column-channel", table, hashes,
    passes: { ...RENDER_PASS_FORMAT, surface_tracking: { encoding: "float32", channels: ["part_index", "local_x", "local_y", "local_z"], miss: 0 } },
  });
  json("scene.json", shot);
  json("camera.json", { trajectory, calibration: take.calibration, mapping: take.mapping, trackingEvents: take.trackingEvents });
  for (const kind of RENDER_PASS_KINDS) addFile(parts, `${kind}.bin`, frames.map((frame) => bytes(frame[kind].data)));
  addFile(parts, "surface_tracking.bin", frames.map((frame) => {
    if (!frame.surfaceTracking) throw new Error("Surface tracking is missing from a reference frame.");
    return bytes(frame.surfaceTracking);
  }));
  parts.push(new Uint8Array(2 * BLOCK));
  return new Blob(parts, { type: "application/x-tar" });
}
