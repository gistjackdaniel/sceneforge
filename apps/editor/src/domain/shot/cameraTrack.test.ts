import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BackboneCameraBuilder } from "../rendering/backboneV01";
import { buildBackboneCameraForClip } from "../../application/services/backboneExport";
import { commitFieldsFromCapture } from "../../application/services/cameraCapture";
import type { Project } from "../project/types";
import {
  CameraTrackInputError,
  createFixtureCameraTrackAdapter,
  identityCalibration,
  identityMapping,
  readCameraTrackCapture,
  resolveVirtualKeyframes,
  type CameraTrackCapture,
} from "./cameraTrack";
import { applyShotCommand } from "./evolve";
import { recordedTakePlaybackPoses, selectedTake, viewportPlaybackPoses } from "./queries";
import { parseShot } from "./schema";
import { shotId, type Shot, type ShotCommand } from "./types";

const now = "2026-11-04T00:00:00.000Z";

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

const phone = (): CameraTrackCapture => ({
  samples: [
    {
      frame: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      deviceTimestampNs: 0,
      timecode: "00:00:00:00",
      trackingState: "normal",
    },
    {
      frame: 24,
      position: [2, 0, 0],
      rotation: [0, 0, 0, 1],
      deviceTimestampNs: 1_000_000_000,
      timecode: "00:00:01:00",
      trackingState: "limited",
    },
  ],
  calibration: {
    calibrationId: "cal_phone",
    arFramework: "arkit",
    scale: 2,
    rotation: [0, 0, 0, 1],
    translation: [0, 1, 0],
    method: "marker",
    createdAt: now,
  },
  intrinsics: {
    focalLengthMm: 35,
    sensorSizeMm: [36, 24],
    distortion: [0.1, 0.01, 0, 0, 0],
  },
  trackingEvents: [
    { kind: "tracking_lost", frame: 24 },
    { kind: "drift_correction", frame: 24, estimatedDriftM: 0.02 },
  ],
});

const projectFor = (shot: Shot): Project => ({
  id: "p",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: {
    "seq-1": { id: "seq-1", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, 48], fps: 30 },
  },
  clips: {
    [shot.id]: {
      id: shot.id,
      name: "A",
      start: 0,
      end: shot.time.durationFrames,
      duration: shot.time.durationFrames,
      durationFrames: shot.time.durationFrames,
      sourceType: "empty",
      clipGraphId: "g",
      cacheStatus: "valid",
    },
  },
  shots: { [shot.id]: shot },
  clipGraphs: {},
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

const reload = (shot: Shot): Shot => parseShot(JSON.parse(JSON.stringify(shot)));

describe("camera track on the shot record", () => {
  it("restores the same camera path from the saved shot for viewport and recorded-take playback", async () => {
    const capture = await readCameraTrackCapture(createFixtureCameraTrackAdapter(phone()));
    const committed = step(empty(), {
      type: "COMMIT_CAMERA_TAKE",
      shotId: shotId("clip-001"),
      source: "record",
      ...commitFieldsFromCapture(capture),
    });
    const saved = reload(committed);
    const again = reload(saved);
    const viewport = viewportPlaybackPoses(saved, 25);
    const recorded = recordedTakePlaybackPoses(saved, 25);
    expect(viewport).toEqual(recorded);
    expect(viewportPlaybackPoses(again, 25)).toEqual(viewport);
    expect(recordedTakePlaybackPoses(again, 25)).toEqual(recorded);
    expect(viewport[0]?.position).toEqual([0, 1, 0]);
    expect(viewport[24]?.position).toEqual([4, 1, 0]);

    const take = selectedTake(saved);
    const key = take?.keys[0];
    expect(key).toBeDefined();
    if (!key) return;
    const rotation: [number, number, number, number] = [key.rotation[0], key.rotation[1], key.rotation[2], key.rotation[3]];
    const position: [number, number, number] = [key.position[0], key.position[1], key.position[2]];
    const c2w = BackboneCameraBuilder.composeC2W(
      position,
      BackboneCameraBuilder.glToOpenCvRotation(BackboneCameraBuilder.quatToMat3(rotation)),
    );
    const exported = buildBackboneCameraForClip(projectFor(saved), saved.id, [1280, 720], { numFrames: 25 });
    expect(exported.fps).toBe(saved.time.fps);
    expect(exported.frames[0]?.c2w).toEqual(c2w);
    expect(take?.samples[1]?.position).toEqual([2, 0, 0]);
    expect(take?.samples[1]?.trackingState).toBe("limited");
  });

  it("keeps the original samples when gain changes the virtual camera", async () => {
    const capture = await readCameraTrackCapture(createFixtureCameraTrackAdapter(phone()));
    const committed = step(empty(), {
      type: "COMMIT_CAMERA_TAKE",
      shotId: shotId("clip-001"),
      source: "record",
      ...commitFieldsFromCapture(capture),
    });
    const before = selectedTake(committed)?.samples.map((sample) => sample.position);
    const gained = step(committed, {
      type: "SET_CAMERA_TRACK_MAPPING",
      shotId: committed.id,
      mapping: {
        mode: "gain",
        translationGain: [0.5, 1, 1],
        rotationGain: 1,
        smoothing: 0,
        timeScale: 1,
        timeOffsetFrames: 0,
      },
    });
    const take = selectedTake(gained);
    expect(take?.samples.map((sample) => sample.position)).toEqual(before);
    expect(take?.keys[1]?.position[0]).toBeCloseTo(2, 6);
    expect(take?.keys[1]?.position[1]).toBeCloseTo(1, 6);
    expect(take?.keys[1]?.position[2]).toBeCloseTo(0, 6);
    expect(viewportPlaybackPoses(gained, 25)).toEqual(recordedTakePlaybackPoses(gained, 25));
  });

  it("matches Three.js when the calibration rotation is applied to the device rotation", () => {
    const yaw = Math.PI / 2;
    const calibrationRotation: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const device: [number, number, number, number] = [0, 0, 0, 1];
    const keys = resolveVirtualKeyframes({
      samples: [{ frame: 0, position: [1, 0, 0], rotation: device, trackingState: "normal" }],
      calibration: { ...identityCalibration(), rotation: calibrationRotation, method: "manual_anchor" },
      mapping: identityMapping(),
    });
    const expected = new THREE.Quaternion(...calibrationRotation).multiply(new THREE.Quaternion(...device));
    expect(keys[0]?.rotation[0]).toBeCloseTo(expected.x, 6);
    expect(keys[0]?.rotation[1]).toBeCloseTo(expected.y, 6);
    expect(keys[0]?.rotation[2]).toBeCloseTo(expected.z, 6);
    expect(keys[0]?.rotation[3]).toBeCloseTo(expected.w, 6);
    const rotated = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...calibrationRotation));
    expect(keys[0]?.position[0]).toBeCloseTo(rotated.x, 6);
    expect(keys[0]?.position[1]).toBeCloseTo(rotated.y, 6);
    expect(keys[0]?.position[2]).toBeCloseTo(rotated.z, 6);
  });

  it("rejects an invalid capture and an aborted read", async () => {
    const adapter = createFixtureCameraTrackAdapter(phone());
    await expect(readCameraTrackCapture({
      id: "bad",
      readCapture: () => Promise.resolve({ samples: [] } as unknown as CameraTrackCapture),
    })).rejects.toBeInstanceOf(CameraTrackInputError);
    await expect(readCameraTrackCapture(adapter, AbortSignal.abort())).rejects.toBeInstanceOf(CameraTrackInputError);
  });
});
