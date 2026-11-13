import { describe, expect, it } from "vitest";
import { applyShotCommand } from "../shot/evolve";
import { parseShot } from "../shot/schema";
import { selectedTake } from "../shot/queries";
import { shotId, subjectId, type Shot } from "../shot/types";
import { sanitizeLegacyToken } from "../worlds/ids";
import { hashNormalized, hashString } from "./hashNormalized";
import { deriveInstanceTable } from "./instanceTable";
import { renderPassHashInput, upstreamPassRecord } from "./passHash";
import {
  PHASE0_ACTOR_A,
  PHASE0_ACTOR_B,
  PHASE0_ASSET_REVISION,
  PHASE0_IDS,
  PHASE0_SEED,
  PHASE0_TABLE,
  phase0Shot,
} from "./phase0Shot";
import { RenderPassRenderer } from "./RenderPassRenderer";
import { defaultRenderPassSpec, RENDER_PASS_KINDS, RENDERER_VERSION, type InstanceIdEntry, type RenderPassKind } from "./types";

const spec = defaultRenderPassSpec(16, 12);
const frameRange = { start: 0, end: 127 };
const traceFrames = [0, 64, 127];
const now = "2026-11-12T00:00:00.000Z";

const context = {
  spec,
  frameRange,
  assetRevision: PHASE0_ASSET_REVISION,
  seed: PHASE0_SEED,
};

const reload = (shot: Shot): Shot => parseShot(JSON.parse(JSON.stringify(shot)));

const render = (shot: Shot, extra?: { instanceTable?: readonly InstanceIdEntry[] }) => {
  const result = RenderPassRenderer.render(shot, { ...context, traceFrames, ...extra });
  if (!result.ok) throw new Error(result.reason);
  return result.output;
};

const hashesOf = (shot: Shot, extra?: { instanceTable?: readonly InstanceIdEntry[] }) => {
  const result = RenderPassRenderer.passHashes(shot, { ...context, ...extra });
  if (!result.ok) throw new Error(result.reason);
  return result.hashes;
};

const sameBytes = (left: Uint8Array | Uint32Array, right: Uint8Array | Uint32Array) => {
  expect(left.length).toBe(right.length);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      throw new Error(`byte ${index}: ${left[index]} !== ${right[index]}`);
    }
  }
};

const sameFloats = (left: Float32Array, right: Float32Array) => {
  expect(left.length).toBe(right.length);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      throw new Error(`float ${index}: ${left[index]} !== ${right[index]}`);
    }
  }
};

const containsString = (value: unknown, needle: string): boolean => {
  if (typeof value === "string") return value === needle;
  if (Array.isArray(value)) return value.some((item) => containsString(item, needle));
  if (value && typeof value === "object") return Object.values(value).some((item) => containsString(item, needle));
  return false;
};

const hitCounts = (ids: Uint32Array, table: readonly InstanceIdEntry[]) => {
  const counts = new Map<string, number>();
  for (const value of ids) {
    if (value === 0) continue;
    const entry = table.find((item) => item.index === value);
    const key = entry?.persistentId ?? `missing:${value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

describe("phase 2 render passes", () => {
  it("round-trips the camera path and five passes with equal hashes", () => {
    const shot = phase0Shot();
    expect(shot.time.fps).toBe(16);
    expect(shot.time.durationFrames).toBe(128);
    expect(shot.subjects.map((subject) => subject.id)).toEqual([
      PHASE0_IDS.actorA,
      PHASE0_IDS.actorB,
      PHASE0_IDS.cup,
      PHASE0_IDS.table,
    ]);
    expect(shot.environment?.worldId).toBe(PHASE0_IDS.room);
    const tableSubject = shot.subjects.find((subject) => subject.id === PHASE0_IDS.table);
    const actorA = shot.subjects.find((subject) => subject.id === PHASE0_IDS.actorA);
    const actorB = shot.subjects.find((subject) => subject.id === PHASE0_IDS.actorB);
    expect(tableSubject && tableSubject.kind !== "light" && tableSubject.placement.position).toEqual([...PHASE0_TABLE]);
    expect(actorA && actorA.kind !== "light" && actorA.placement.position).toEqual([...PHASE0_ACTOR_A]);
    expect(actorB && actorB.kind !== "light" && actorB.placement.position).toEqual([...PHASE0_ACTOR_B]);

    const loaded = reload(shot);
    const before = render(shot);
    const after = render(loaded);

    expect(before.fps).toBe(shot.time.fps);
    expect(before.cameraId).toBe(PHASE0_IDS.take);
    expect(before.rendererVersion).toBe(RENDERER_VERSION);
    expect(before.trajectory).toHaveLength(128);
    expect(before.trajectory.map((frame) => frame.cameraId)).toEqual(Array(128).fill(PHASE0_IDS.take));
    expect(before.trajectory.map((frame) => frame.frame)).toEqual(Array.from({ length: 128 }, (_, index) => index));
    expect(before.trajectory[0]?.position).toEqual(selectedTake(shot)?.keys[0]?.position);
    expect(before.trajectory[127]?.position).toEqual(selectedTake(shot)?.keys[1]?.position);
    const mid = before.trajectory[64]?.position;
    const start = before.trajectory[0]?.position;
    const end = before.trajectory[127]?.position;
    expect(mid && start && end && mid[2] < start[2] && mid[2] > end[2]).toBe(true);

    expect(after.trajectory).toEqual(before.trajectory);
    expect(after.hashes).toEqual(before.hashes);
    expect(after.table).toEqual(before.table);
    expect(new Set(RENDER_PASS_KINDS.map((kind) => before.hashes[kind])).size).toBe(RENDER_PASS_KINDS.length);

    for (const kind of RENDER_PASS_KINDS) {
      expect(before.frames[0]?.[kind].format.encoding).toBe(
        kind === "rgb" ? "uint8" : kind === "instance_id" ? "uint32" : "float32",
      );
    }
    expect(before.frames[0]?.depth.format).toMatchObject({ space: "camera", axis: "linear_z", units: "meters" });
    expect(before.frames[0]?.normal.format).toMatchObject({ space: "world", normalized: true });
    expect(before.frames[0]?.world_position.format).toMatchObject({ space: "world", units: "meters" });

    before.frames.forEach((frame, index) => {
      const other = after.frames[index];
      if (!other) throw new Error("missing reloaded frame");
      expect(other.camera).toEqual(frame.camera);
      sameBytes(frame.rgb.data, other.rgb.data);
      sameFloats(frame.depth.data, other.depth.data);
      sameFloats(frame.normal.data, other.normal.data);
      sameFloats(frame.world_position.data, other.world_position.data);
      sameBytes(frame.instance_id.data, other.instance_id.data);
    });

    const counts = hitCounts(before.frames[0]?.instance_id.data ?? new Uint32Array(), before.table);
    for (const id of [PHASE0_IDS.actorA, PHASE0_IDS.actorB, PHASE0_IDS.table, PHASE0_IDS.room]) {
      expect(counts.get(id) ?? 0, id).toBeGreaterThan(0);
    }
    const normals = before.frames[0]?.normal.data ?? new Float32Array();
    const ids = before.frames[0]?.instance_id.data ?? new Uint32Array();
    let unitNormals = 0;
    for (let index = 0; index < ids.length; index += 1) {
      if (ids[index] === 0) continue;
      const length = Math.hypot(normals[index * 3] ?? 0, normals[index * 3 + 1] ?? 0, normals[index * 3 + 2] ?? 0);
      expect(length).toBeCloseTo(1, 5);
      unitNormals += 1;
      expect((before.frames[0]?.depth.data[index] ?? 0) > 0).toBe(true);
    }
    expect(unitNormals).toBeGreaterThan(0);
  });

  it("changes every pass hash when the camera moves", () => {
    const shot = phase0Shot();
    const take = selectedTake(shot);
    const key = take?.keys[0];
    if (!take || !key) throw new Error("missing take");
    const edited = applyShotCommand(shot, {
      type: "KEY_CAMERA",
      shotId: shotId(shot.id),
      key: { ...key, position: [key.position[0] + 0.4, key.position[1], key.position[2]] },
    }, now);
    if (!edited.ok) throw new Error(edited.reason);
    const original = hashesOf(shot);
    const moved = hashesOf(edited.shot);
    for (const kind of RENDER_PASS_KINDS) {
      expect(moved[kind]).not.toBe(original[kind]);
    }
    expect(deriveInstanceTable(edited.shot)).toEqual(deriveInstanceTable(shot));
  });

  it("keeps the instance table when only B's hand changes", () => {
    const shot = phase0Shot();
    const edited = applyShotCommand(shot, {
      type: "KEY_SUBJECT_POSE",
      shotId: shotId(shot.id),
      subjectId: subjectId(PHASE0_IDS.actorB),
      key: {
        frame: 0,
        position: [...PHASE0_ACTOR_B],
        rotationEuler: [0, Math.PI / 2, 0],
        scale: [1, 1, 1],
      },
    }, now);
    if (!edited.ok) throw new Error(edited.reason);
    const before = render(shot);
    const after = render(edited.shot);
    expect(after.table).toEqual(before.table);
    expect(deriveInstanceTable(edited.shot)).toEqual(deriveInstanceTable(shot));
    expect(after.hashes.instance_id).not.toBe(before.hashes.instance_id);
    const beforeIds = before.frames[0]?.instance_id.data ?? new Uint32Array();
    const afterIds = after.frames[0]?.instance_id.data ?? new Uint32Array();
    expect(Buffer.from(beforeIds.buffer).equals(Buffer.from(afterIds.buffer))).toBe(false);
  });

  it("keeps pass hashes when only the camera take id is migrated", () => {
    const shot = phase0Shot();
    const take = selectedTake(shot);
    if (!take || shot.camera.status !== "ready") throw new Error("missing take");
    const legacyId = `cam_legacy_${sanitizeLegacyToken(shot.id)}__${sanitizeLegacyToken(take.id)}`;
    expect(legacyId).not.toBe(take.id);
    const migrated = reload({
      ...shot,
      camera: {
        ...shot.camera,
        selectedTakeId: legacyId as typeof shot.camera.selectedTakeId,
        takes: [{ ...take, id: legacyId as typeof take.id }],
      },
    });
    const original = render(shot);
    const renamed = render(migrated);
    expect(renamed.cameraId).toBe(legacyId);
    expect(renamed.hashes).toEqual(original.hashes);
    expect(renamed.trajectory.map(({ cameraId: _id, ...frame }) => frame)).toEqual(
      original.trajectory.map(({ cameraId: _id, ...frame }) => frame),
    );
    sameBytes(original.frames[0]?.instance_id.data ?? new Uint32Array(), renamed.frames[0]?.instance_id.data ?? new Uint32Array());
    const record = upstreamPassRecord(shot, spec);
    for (const id of [take.id, legacyId, PHASE0_IDS.actorA, PHASE0_IDS.actorB, PHASE0_IDS.cup, PHASE0_IDS.table, PHASE0_IDS.room]) {
      expect(containsString(record, id)).toBe(false);
    }
  });

  it("changes only the instance_id hash when the id-to-pixel map changes", () => {
    const shot = phase0Shot();
    const table = deriveInstanceTable(shot);
    const first = table[0];
    const second = table[1];
    if (!first || !second) throw new Error("table too small");
    const swapped: InstanceIdEntry[] = table.map((entry) => {
      if (entry.persistentId === first.persistentId) return { ...entry, index: second.index };
      if (entry.persistentId === second.persistentId) return { ...entry, index: first.index };
      return entry;
    });
    const original = hashesOf(shot);
    const remapped = hashesOf(shot, { instanceTable: swapped });
    expect(remapped.instance_id).not.toBe(original.instance_id);
    for (const kind of RENDER_PASS_KINDS) {
      if (kind === "instance_id") continue;
      expect(remapped[kind]).toBe(original[kind]);
    }
  });

  it("leaves non-instance hashes unchanged when an actor id string changes", () => {
    const shot = phase0Shot();
    const legacyActor = `act_legacy_${sanitizeLegacyToken(shot.id)}__${sanitizeLegacyToken(PHASE0_IDS.actorB)}`;
    const migrated = reload({
      ...shot,
      subjects: shot.subjects.map((subject) => subject.id === PHASE0_IDS.actorB ? { ...subject, id: legacyActor as typeof subject.id } : subject),
    });
    const original = hashesOf(shot);
    const renamed = hashesOf(migrated);
    expect(renamed.instance_id).not.toBe(original.instance_id);
    const kinds: RenderPassKind[] = ["rgb", "depth", "normal", "world_position"];
    for (const kind of kinds) expect(renamed[kind]).toBe(original[kind]);
    expect(deriveInstanceTable(migrated).map((entry) => entry.persistentId)).toContain(legacyActor);
  });

  it("hashes object keys independently of order and keeps model version in the renderer slot", () => {
    expect(hashNormalized({ b: 1, a: { d: 2, c: 3 } })).toBe(hashNormalized({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashNormalized([1, 2])).not.toBe(hashNormalized([2, 1]));
    const shot = phase0Shot();
    const hashed = RenderPassRenderer.passHashes(shot, context);
    if (!hashed.ok) throw new Error(hashed.reason);
    const again = RenderPassRenderer.passHashes({ ...shot, name: "Renamed", subjects: shot.subjects.map((subject) => ({ ...subject, name: `${subject.name} display` })) }, context);
    if (!again.ok) throw new Error(again.reason);
    expect(again.hashes).toEqual(hashed.hashes);
    const seeded = hashesOf(shot);
    const otherSeed = RenderPassRenderer.passHashes(shot, { ...context, seed: PHASE0_SEED + 1 });
    if (!otherSeed.ok) throw new Error(otherSeed.reason);
    for (const kind of RENDER_PASS_KINDS) expect(otherSeed.hashes[kind]).not.toBe(seeded[kind]);
    expect(RENDERER_VERSION).toBe("aov-reference-1");
    const table = deriveInstanceTable(shot);
    const rgbInput = renderPassHashInput(shot, "rgb", context, table);
    expect(rgbInput).toEqual({
      assetRevision: PHASE0_ASSET_REVISION,
      modelVersion: RENDERER_VERSION,
      seed: PHASE0_SEED,
      passHash: rgbInput.passHash,
      passKind: "rgb",
      frameRange: [0, 127],
      fps: 16,
    });
    expect(rgbInput.instanceMapHash).toBeUndefined();
    const idInput = renderPassHashInput(shot, "instance_id", context, table);
    expect(typeof idInput.instanceMapHash).toBe("string");
    expect(idInput.passHash).toBe(rgbInput.passHash);
    const otherRange = RenderPassRenderer.passHashes(shot, { ...context, frameRange: { start: 0, end: 10 } });
    if (!otherRange.ok) throw new Error(otherRange.reason);
    for (const kind of RENDER_PASS_KINDS) expect(otherRange.hashes[kind]).not.toBe(hashed.hashes[kind]);
    const otherFps = hashesOf(reload({ ...shot, time: { ...shot.time, fps: 24 } }));
    for (const kind of RENDER_PASS_KINDS) expect(otherFps[kind]).not.toBe(hashed.hashes[kind]);
  });

  it("locks per-pass golden hashes and reference pixel digests", () => {
    const output = render(phase0Shot());
    expect(output.hashes).toEqual({
      rgb: "ecb96de0",
      depth: "f1acda6a",
      normal: "f8939ae8",
      world_position: "a5f0fc39",
      instance_id: "b39c68c7",
    });
    const digest = (data: ArrayBufferView) =>
      hashString(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"));
    const pixels = Object.fromEntries(output.frames.map((frame) => {
      const row: Record<string, string> = {};
      for (const kind of RENDER_PASS_KINDS) row[kind] = digest(frame[kind].data);
      return [frame.frame, row];
    }));
    expect(pixels).toEqual({
      0: { rgb: "f92bca0f", depth: "94c19014", normal: "76fe4699", world_position: "936ad02d", instance_id: "fa1f547a" },
      64: { rgb: "2818d77f", depth: "f6b55275", normal: "5de49596", world_position: "7e774b73", instance_id: "1c4a7858" },
      127: { rgb: "cd191952", depth: "8241b8c0", normal: "edc11da8", world_position: "0327c371", instance_id: "46fea3a1" },
    });
  });
});
