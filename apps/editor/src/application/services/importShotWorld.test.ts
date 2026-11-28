import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { importShotWorld, inspectShotWorldGlb } from "./importShotWorld";
import {
  importedWorldUri, PHASE1_CLASSROOM_WORLD, registerShotWorld, resolveShotWorldRevision, revertShotWorld, shotWorldRevisionId,
} from "../../domain/worlds/importedShotWorld";

const classroom = PHASE1_CLASSROOM_WORLD;

const externalGeometry = () => {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 12, uri: "geometry.bin" }],
    bufferViews: [{ buffer: 0, byteLength: 12 }],
    accessors: [{ count: 1, type: "VEC3", bufferView: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  }));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(28 + paddedLength + 12);
  const header = new DataView(bytes);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.byteLength, true);
  header.setUint32(12, paddedLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, paddedLength).fill(0x20).set(json);
  header.setUint32(20 + paddedLength, 12, true);
  header.setUint32(24 + paddedLength, 0x004e4942, true);
  return bytes;
};

describe("shot world import", () => {
  it("matches the bundled classroom revision to the actual embedded geometry and textures", async () => {
    const room = await readFile(new URL(`../../../public/${classroom.uri}`, import.meta.url));
    const bytes = await new Blob([new Uint8Array(room)]).arrayBuffer();
    expect(bytes.byteLength).toBe(classroom.byteLength);
    expect(createHash("sha256").update(room).digest("hex")).toBe(classroom.contentHash);
    expect(inspectShotWorldGlb(bytes)).toEqual({ meshCount: 301, texturedMaterialCount: 60 });
  });

  it("rejects external geometry before committing the world", async () => {
    const glb = new Blob([externalGeometry()]);
    await expect(importShotWorld(glb, { name: "External mesh" })).rejects.toThrow(/외부 파일/);
  });

  it("keeps a shot's pinned geometry available across asset imports and reverts", () => {
    const initial = registerShotWorld("world-shared-room", classroom, "2026-11-18T09:00:00Z");
    const alternateHash = "1".repeat(64);
    const alternate = { ...classroom, name: "Alternate", uri: importedWorldUri(alternateHash), contentHash: alternateHash };
    const updated = registerShotWorld(initial.id, alternate, "2026-11-18T10:00:00Z", initial);
    const pinnedClassroom = resolveShotWorldRevision(updated, shotWorldRevisionId(classroom));
    expect(updated.id).toBe(initial.id);
    expect(updated.version).toBe(2);
    expect(updated.surfaceMeshPath).toBe(alternate.uri);
    expect(pinnedClassroom?.uri).toBe(classroom.uri);

    const restored = revertShotWorld(updated, 1, "2026-11-18T11:00:00Z");
    expect(restored?.surfaceMeshPath).toBe(classroom.uri);
    expect(resolveShotWorldRevision(restored, shotWorldRevisionId(alternate))?.uri).toBe(alternate.uri);
    expect(restored && registerShotWorld(initial.id, alternate, "2026-11-18T12:00:00Z", restored).versions).toHaveLength(2);
  });
});
