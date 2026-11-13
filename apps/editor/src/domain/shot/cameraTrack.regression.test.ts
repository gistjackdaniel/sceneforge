import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBackboneCameraForClip } from "../../application/services/backboneExport";
import type { Project } from "../project/types";
import { eulerToQuaternionZYX, migrateZyxEncodedQuaternion, quaternionAngleRadians } from "./cameraRotation";
import { EULER_ORDER, eulerToQuaternion, quaternionToEuler } from "./euler";
import { applyShotCommand } from "./evolve";
import { selectedTake } from "./queries";
import { parseShot } from "./schema";
import { CAMERA_TAKE_ID_PATTERN, legacyCameraTakeId } from "./takeId";
import { shotId, takeId, type Shot, type ShotCommand } from "./types";

const now = "2026-11-04T00:00:00.000Z";
const euler: [number, number, number] = [-0.3, 0.8, 0.1];

const empty = (): Shot => parseShot({
  schemaVersion: 1,
  id: "clip-001",
  name: "Shot",
  time: { fps: 24, durationFrames: 48, origin: "clip_local" },
  subjects: [],
  camera: { status: "empty", lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 }, interpolation: "linear" },
  renders: [],
});

const step = (shot: Shot, command: ShotCommand): Shot => {
  const edited = applyShotCommand(shot, command, now);
  if (!edited.ok) throw new Error(edited.reason);
  return edited.shot;
};

const key = (rotation: [number, number, number, number]) => ({
  frame: 0,
  position: [0, 1, 4] as [number, number, number],
  rotation,
  focalLengthMm: 35,
});

const rawShot = (takes: { id: string; rotation: [number, number, number, number] }[]) => ({
  schemaVersion: 1,
  id: "clip-001",
  name: "Shot",
  time: { fps: 24, durationFrames: 48, origin: "clip_local" },
  subjects: [],
  camera: {
    status: "ready",
    lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
    interpolation: "linear",
    selectedTakeId: takes[0]?.id ?? "take-a",
    takes: takes.map((take) => ({
      schemaVersion: 1,
      id: take.id,
      name: take.id,
      source: "manual",
      keys: [key(take.rotation)],
      createdAt: now,
    })),
  },
  renders: [],
});

describe("camera take regressions", () => {
  it("stores XYZ, the same order Object3D.rotation uses", () => {
    const object = new THREE.Object3D();
    expect(object.rotation.order).toBe("XYZ");
    expect(object.rotation.order).toBe(EULER_ORDER);
    object.rotation.set(euler[0], euler[1], euler[2]);
    const stored = eulerToQuaternion(euler);
    expect(stored[0]).toBeCloseTo(object.quaternion.x, 6);
    expect(stored[1]).toBeCloseTo(object.quaternion.y, 6);
    expect(stored[2]).toBeCloseTo(object.quaternion.z, 6);
    expect(stored[3]).toBeCloseTo(object.quaternion.w, 6);
    const roundTrip = quaternionToEuler(stored);
    expect(roundTrip[0]).toBeCloseTo(euler[0], 5);
    expect(roundTrip[1]).toBeCloseTo(euler[1], 5);
    expect(roundTrip[2]).toBeCloseTo(euler[2], 5);
    const degrees = (quaternionAngleRadians(stored, eulerToQuaternionZYX(euler)) * 180) / Math.PI;
    expect(degrees).toBeCloseTo(14.1, 1);
  });

  it("shows the committed quaternion with the same XYZ rotation the viewport applies", () => {
    const committed = eulerToQuaternion(euler);
    const shot = step(empty(), { type: "KEY_CAMERA", shotId: shotId("clip-001"), key: key(committed) });
    const stored = selectedTake(shot)?.keys[0]?.rotation;
    expect(stored).toBeDefined();
    if (!stored) return;
    const displayed = new THREE.Object3D();
    displayed.rotation.order = EULER_ORDER;
    displayed.quaternion.set(stored[0], stored[1], stored[2], stored[3]);
    const shown = new THREE.Euler().setFromQuaternion(displayed.quaternion, EULER_ORDER);
    expect(shown.x).toBeCloseTo(euler[0], 5);
    expect(shown.y).toBeCloseTo(euler[1], 5);
    expect(shown.z).toBeCloseTo(euler[2], 5);
    expect(selectedTake(shot)?.rotationStorage).toBe("quaternion_xyzw");
  });

  it("migrates a stored ZYX quaternion once and then leaves it alone", () => {
    const encoded = eulerToQuaternionZYX(euler);
    const once = parseShot(rawShot([{ id: "take-old", rotation: encoded }]));
    const twice = parseShot(JSON.parse(JSON.stringify(once)));
    const take = once.camera.status === "ready" ? once.camera.takes[0] : undefined;
    const again = twice.camera.status === "ready" ? twice.camera.takes[0] : undefined;
    expect(take?.keys[0]?.rotation).toEqual(migrateZyxEncodedQuaternion(encoded));
    expect(again?.keys[0]?.rotation).toEqual(take?.keys[0]?.rotation);
    expect(again?.id).toBe(take?.id);
    expect(again?.legacyRefs).toEqual(take?.legacyRefs);
    const angle = quaternionAngleRadians(take?.keys[0]?.rotation ?? [0, 0, 0, 1], eulerToQuaternion(euler));
    expect(angle).toBeLessThan(1e-5);
  });

  it("mints cam_<ULID> and does not reuse a deleted take id", () => {
    const first = step(empty(), { type: "KEY_CAMERA", shotId: shotId("clip-001"), key: key([0, 0, 0, 1]) });
    const firstId = selectedTake(first)?.id ?? "";
    expect(firstId).toMatch(CAMERA_TAKE_ID_PATTERN);
    const deleted = step(first, { type: "DELETE_CAMERA_TAKE", shotId: first.id, takeId: takeId(firstId) });
    expect(deleted.camera.status).toBe("empty");
    if (deleted.camera.status === "empty") expect(deleted.camera.retiredTakeIds).toContain(firstId);
    const second = step(deleted, { type: "COMMIT_CAMERA_TAKE", shotId: deleted.id, source: "manual", keys: [key([0, 0, 0, 1])] });
    const secondId = selectedTake(second)?.id ?? "";
    expect(secondId).toMatch(CAMERA_TAKE_ID_PATTERN);
    expect(secondId).not.toBe(firstId);
    if (second.camera.status === "ready") expect(second.camera.retiredTakeIds).toContain(firstId);
  });

  it("gives the same legacy id for the same previous take id", () => {
    const raw = rawShot([
      { id: "take-clip-001-1", rotation: [0, 0, 0, 1] },
      { id: "take-a", rotation: [0, 0, 0, 1] },
    ]);
    raw.camera.selectedTakeId = "take-clip-001-1";
    const first = parseShot(JSON.parse(JSON.stringify(raw)));
    const second = parseShot(JSON.parse(JSON.stringify(raw)));
    const ids = (shot: Shot) => shot.camera.status === "ready" ? shot.camera.takes.map((take) => take.id) : [];
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first)[0]).toBe(legacyCameraTakeId("clip-001", "take-clip-001-1"));
    expect(ids(first)[1]).toBe(legacyCameraTakeId("clip-001", "take-a"));
    const refs = first.camera.status === "ready" ? first.camera.takes.map((take) => take.legacyRefs) : [];
    expect(refs[0]).toEqual([{ kind: "camera_take", shotId: "clip-001", takeId: "take-clip-001-1" }]);
    expect(refs[1]).toEqual([{ kind: "camera_take", shotId: "clip-001", takeId: "take-a" }]);
    const stable = parseShot(JSON.parse(JSON.stringify(first)));
    expect(ids(stable)).toEqual(ids(first));
    expect(stable.camera.status === "ready" && stable.camera.takes.map((take) => take.legacyRefs)).toEqual(refs);
  });

  it("suffixes a legacy id when sanitizing two old ids would collide", () => {
    const shot = parseShot(rawShot([
      { id: "take-a", rotation: [0, 0, 0, 1] },
      { id: "take_a", rotation: [0, 0, 0, 1] },
    ]));
    const takes = shot.camera.status === "ready" ? shot.camera.takes : [];
    expect(takes[0]?.id).toBe(legacyCameraTakeId("clip-001", "take-a"));
    expect(takes[1]?.id).toBe(`${legacyCameraTakeId("clip-001", "take_a")}_2`);
    expect(takes[0]?.legacyRefs[0]?.takeId).toBe("take-a");
    expect(takes[1]?.legacyRefs[0]?.takeId).toBe("take_a");
  });

  it("exports Shot.time.fps and ignores Sequence.fps", () => {
    const shot = parseShot({
      ...rawShot([{ id: "take-a", rotation: [0, 0, 0, 1] }]),
      time: { fps: 25, durationFrames: 10, origin: "clip_local" },
    });
    const project: Project = {
      id: "p",
      name: "Test",
      createdAt: now,
      updatedAt: now,
      metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
      activeSequenceId: "seq-1",
      sequences: {
        "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-001"], playhead: 0, visibleRange: [0, 10], fps: 30 },
      },
      clips: {
        "clip-001": {
          id: "clip-001",
          name: "A",
          start: 0,
          end: 10,
          duration: 10,
          durationFrames: 10,
          sourceType: "empty",
          clipGraphId: "g",
          cacheStatus: "valid",
        },
      },
      shots: { "clip-001": shot },
      clipGraphs: {},
      nodes: {},
      references: {},
      dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
      worlds: {},
      assets: {},
      caches: {},
      connectors: {},
      libraryNodeIds: [],
    };
    const cam = buildBackboneCameraForClip(project, "clip-001", [1280, 720]);
    expect(cam.fps).toBe(25);
    expect(cam.frames).toHaveLength(10);
    expect(shot.camera.status === "ready" && shot.camera.takes[0]?.id).toBe(legacyCameraTakeId("clip-001", "take-a"));
  });
});
