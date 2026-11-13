import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BackboneCameraBuilder } from "../rendering/backboneV01";
import { buildBackboneCameraForClip } from "../../application/services/backboneExport";
import { commitFieldsFromCapture } from "../../application/services/cameraCapture";
import { rotateVec3, quaternionAngleRadians } from "./cameraRotation";
import { deviceTimestampToFrame } from "./deviceTimestamp";
import { devicePointToScene, devicePoseToScenePose, glCameraLook, opencvCameraToGl, poseFromColumnMajor } from "./deviceFrame";
import {
  CameraTrackInputError,
  createFixtureCameraTrackAdapter,
  identityCalibration,
  identityMapping,
  readCameraTrackCapture,
} from "./cameraTrack";
import { createMobileSessionAdapter } from "./mobileSession";
import { applyShotCommand } from "./evolve";
import { recordedTakePlaybackPoses, resolveCameraTakeFrames, selectedTake, viewportPlaybackPoses } from "./queries";
import { parseShot } from "./schema";
import { cameraLayersFromSamples, detectTrackingLoss, estimateReferenceDrift } from "./trackingContinuity";
import { solveWorldCalibration } from "./worldCalibration";
import { CAMERA_TAKE_ID_PATTERN } from "./takeId";
import { shotId, type CameraTake, type Quat, type Shot, type ShotCommand, type Vec3 } from "./types";
import type { Project } from "../project/types";

const now = "2026-11-12T00:00:00.000Z";
const FPS = 16;
const FRAMES = 128;

const emptyShot = (): Shot => parseShot({
  schemaVersion: 1,
  id: "clip-mobile",
  name: "Mobile",
  time: { fps: FPS, durationFrames: FRAMES, origin: "clip_local" },
  subjects: [],
  camera: { status: "empty", lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 }, interpolation: "linear" },
  renders: [],
});

const step = (shot: Shot, command: ShotCommand): Shot => {
  const edited = applyShotCommand(shot, command, now);
  if (!edited.ok) throw new Error(edited.reason);
  return edited.shot;
};

const projectFor = (shot: Shot): Project => ({
  id: "p",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: {
    "seq-1": { id: "seq-1", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, FRAMES], fps: 24 },
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

const session = () => ({
  framework: "arkit" as const,
  cameraLocal: "gl" as const,
  intrinsics: {
    imageSize: [1920, 1080] as [number, number],
    fx: 1500,
    fy: 1500,
    cx: 960,
    cy: 540,
    focalLengthMm: 28,
    distortion: [0.01, 0.001, 0, 0, 0] as [number, number, number, number, number],
  },
  frames: Array.from({ length: FRAMES }, (_, frame) => {
    const limited = frame >= 30 && frame < 40;
    const lost = frame >= 40 && frame < 56;
    return {
      timestampNs: 5_000_000_000 + Math.round((frame / FPS) * 1e9),
      pose: {
        kind: "quaternion" as const,
        position: [frame * 0.01, 1.5, frame >= 56 ? 0.25 : 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      trackingState: lost ? "notAvailable" as const : limited ? "limited" as const : "normal" as const,
    };
  }),
});

const numberBits = (value: unknown): Buffer => {
  const nums: number[] = [];
  const walk = (item: unknown): void => {
    if (typeof item === "number") nums.push(item);
    else if (typeof item === "string") throw new Error(`unexpected string in camera frames: ${item}`);
    else if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === "object") {
      for (const key of Object.keys(item as object).sort()) walk((item as Record<string, unknown>)[key]);
    }
  };
  walk(value);
  return Buffer.from(Float64Array.from(nums).buffer);
};

const inverse = (rotation: Quat, point: Vec3): [number, number, number] =>
  rotateVec3([-rotation[0], -rotation[1], -rotation[2], rotation[3]], point);

describe("mobile session frame", () => {
  it("maps ARKit Y-up right-handed meters onto the scene basis", () => {
    expect(devicePointToScene("arkit", [1, 0, 0])).toEqual([1, 0, 0]);
    expect(devicePointToScene("arkit", [0, 1, 0])).toEqual([0, 1, 0]);
    expect(devicePointToScene("arkit", [0, 0, 1])).toEqual([0, 0, 1]);
    const pose = devicePoseToScenePose("arkit", { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] });
    expect(pose.position).toEqual([0, 1.5, 0]);
    const look = glCameraLook(pose.rotation);
    expect(look[0]).toBeCloseTo(0, 6);
    expect(look[1]).toBeCloseTo(0, 6);
    expect(look[2]).toBeCloseTo(-1, 6);
    const yaw = Math.PI / 2;
    const turned = devicePoseToScenePose("arcore", {
      position: [0, 0, 0],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    });
    const turnedLook = glCameraLook(turned.rotation);
    expect(turnedLook[0]).toBeCloseTo(-1, 6);
    expect(turnedLook[1]).toBeCloseTo(0, 6);
    expect(turnedLook[2]).toBeCloseTo(0, 6);
  });

  it("reads a column-major pose and converts an OpenCV camera into the GL frame", () => {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    matrix.setPosition(1, 2, 3);
    const decoded = poseFromColumnMajor(matrix.toArray());
    expect(decoded.position[0]).toBeCloseTo(1, 6);
    expect(decoded.position[1]).toBeCloseTo(2, 6);
    expect(decoded.position[2]).toBeCloseTo(3, 6);
    expect(decoded.rotation[1]).toBeCloseTo(quaternion.y, 6);
    const gl = opencvCameraToGl([0, 0, 0, 1]);
    const back = BackboneCameraBuilder.glToOpenCvRotation(BackboneCameraBuilder.quatToMat3(gl));
    expect(back[0]?.[0]).toBeCloseTo(1, 6);
    expect(back[1]?.[1]).toBeCloseTo(1, 6);
    expect(back[2]?.[2]).toBeCloseTo(1, 6);
    expect(glCameraLook(gl)[2]).toBeCloseTo(1, 6);
  });

  it("uses the injected timestamp function and Shot.time.fps", async () => {
    expect(deviceTimestampToFrame({ deviceTimestampNs: 1_000_000_000, originTimestampNs: 0, fps: FPS })).toBe(FPS);
    const seen: number[] = [];
    const capture = await readCameraTrackCapture(createMobileSessionAdapter(session(), {
      fps: FPS,
      originTimestampNs: 5_000_000_000,
      timestampToFrame: ({ fps, deviceTimestampNs, originTimestampNs }) => {
        seen.push(fps);
        return Math.round(((deviceTimestampNs - originTimestampNs) / 1e9) * fps);
      },
    }));
    expect(seen.every((fps) => fps === FPS)).toBe(true);
    expect(capture.samples).toHaveLength(FRAMES);
    expect(capture.samples[0]?.frame).toBe(0);
    expect(capture.samples[FRAMES - 1]?.frame).toBe(FRAMES - 1);
    expect(capture.samples[0]?.position).toEqual([0, 1.5, 0]);
    await expect(readCameraTrackCapture(createMobileSessionAdapter({ frames: [] }, { fps: FPS }))).rejects.toBeInstanceOf(CameraTrackInputError);
    await expect(readCameraTrackCapture(createFixtureCameraTrackAdapter(capture), AbortSignal.abort())).rejects.toBeInstanceOf(CameraTrackInputError);
  });
});

describe("world calibration", () => {
  it("records the residual of a floor fit and of point correspondences", () => {
    const yaw = Math.PI / 5;
    const rotation: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const translation: Vec3 = [1, 2, -0.5];
    const scale = 1;
    const toDevice = (point: Vec3): [number, number, number] => {
      const shifted: Vec3 = [point[0] - translation[0], point[1] - translation[1], point[2] - translation[2]];
      return inverse(rotation, shifted).map((value) => value / scale) as [number, number, number];
    };
    const floorPoints: Vec3[] = [[0, 0, 0], [2, 0, 0], [0, 0, 2], [1, 0, 1]];
    const floor = floorPoints.map(toDevice);
    const solved = solveWorldCalibration({
      kind: "floor",
      framework: "arkit",
      calibrationId: "cal_floor",
      createdAt: now,
      originDevice: toDevice([0, 0, 0]),
      sceneOrigin: [0, 0, 0],
      floorPointsDevice: floor,
      forwardDevice: inverse(rotation, [0, 0, 1]),
      scale: { mode: "fixed", scale: 1 },
    });
    expect(solved.method).toBe("plane_fit");
    expect(solved.residualRmsM).toBeLessThan(1e-6);
    expect(quaternionAngleRadians(solved.rotation, rotation)).toBeLessThan(1e-6);
    expect(solved.translation[0]).toBeCloseTo(translation[0], 5);
    expect(solved.translation[1]).toBeCloseTo(translation[1], 5);
    expect(solved.translation[2]).toBeCloseTo(translation[2], 5);
    const noisy = floor.map((point, index): Vec3 => index === 3 ? [point[0], point[1] + 0.03, point[2]] : point);
    const noisyFit = solveWorldCalibration({
      kind: "floor",
      framework: "arkit",
      calibrationId: "cal_floor_noise",
      createdAt: now,
      originDevice: noisy[0] ?? [0, 0, 0],
      floorPointsDevice: noisy,
      scale: { mode: "fixed", scale: 1 },
    });
    expect(noisyFit.residualRmsM).toBeGreaterThan(0.005);
    const scenes: Vec3[] = [[0, 1, 0], [1, 1, 0], [0, 1, 2]];
    const pairs = scenes.map((scenePoint) => ({
      scene: scenePoint,
      device: toDevice(scenePoint),
    }));
    const marked = solveWorldCalibration({
      kind: "points",
      framework: "webxr",
      calibrationId: "cal_points",
      createdAt: now,
      pairs,
      rotation: "full",
      scale: { mode: "estimated", knownLengthM: 1, segmentDevice: [pairs[0]?.device ?? [0, 0, 0], pairs[1]?.device ?? [1, 0, 0]] },
    });
    expect(marked.method).toBe("marker");
    expect(marked.scale).toBeCloseTo(1, 5);
    expect(marked.residualRmsM).toBeLessThan(1e-6);
    const fixedWrong = solveWorldCalibration({
      kind: "points",
      framework: "webxr",
      calibrationId: "cal_points_fixed",
      createdAt: now,
      pairs: pairs.slice(0, 2),
      rotation: "yaw_only",
      scale: { mode: "fixed", scale: 2 },
    });
    expect(fixedWrong.residualRmsM).toBeGreaterThan(0.1);
  });
});

describe("resolveCameraTakeFrames", () => {
  const commitMobile = async () => {
    const capture = await readCameraTrackCapture(createMobileSessionAdapter(session(), { fps: FPS }));
    const calibration = {
      ...identityCalibration(),
      calibrationId: "cal_room",
      arFramework: "arkit" as const,
      translation: [0, 1, 0] as [number, number, number],
      method: "manual_anchor" as const,
      residualRmsM: 0.004,
      createdAt: now,
    };
    const layers = cameraLayersFromSamples({
      samples: capture.samples.map((sample) => ({ ...sample, trackingState: sample.trackingState ?? "normal" })),
      calibration,
      lossPolicy: "hold",
      applyDriftCorrection: true,
    });
    const shot = step(emptyShot(), {
      type: "COMMIT_CAMERA_TAKE",
      shotId: shotId("clip-mobile"),
      source: "record",
      ...commitFieldsFromCapture(capture),
      calibration,
      trackingEvents: layers.trackingEvents,
      mapping: layers.mapping,
    });
    return { capture, shot };
  };

  it("restores one camera path for viewport and recorded playback at 16fps / 128 frames", async () => {
    const { capture, shot } = await commitMobile();
    const saved = parseShot(JSON.parse(JSON.stringify(shot)));
    const again = parseShot(JSON.parse(JSON.stringify(saved)));
    const viewport = viewportPlaybackPoses(saved, FRAMES);
    const recorded = recordedTakePlaybackPoses(saved, FRAMES);
    expect(viewport).toEqual(recorded);
    expect(viewportPlaybackPoses(again, FRAMES)).toEqual(viewport);
    expect(recordedTakePlaybackPoses(again, FRAMES)).toEqual(recorded);
    const take = selectedTake(saved);
    expect(take?.id).toMatch(CAMERA_TAKE_ID_PATTERN);
    expect(take?.samples.map((sample) => sample.position)).toEqual(capture.samples.map((sample) => sample.position));
    expect(take?.samples[56]?.position[2]).toBeCloseTo(0.25, 6);
    const resolved = resolveCameraTakeFrames(take as CameraTake, saved);
    expect(resolved).toHaveLength(FRAMES);
    expect(resolved.map((frame) => frame.position)).toEqual(viewport.map((pose) => pose.position));
    expect(resolved[56]?.position[2]).toBeCloseTo(0, 6);
    expect(resolved[35]?.position).toEqual(resolved[29]?.position);
    const loss = detectTrackingLoss(take?.samples ?? []);
    expect(loss).toEqual([
      { state: "limited", startFrame: 30, endFrame: 40 },
      { state: "not_available", startFrame: 40, endFrame: 56 },
    ]);
    const key = resolved[0];
    if (!key) throw new Error("missing frame");
    const c2w = BackboneCameraBuilder.composeC2W(
      [key.position[0], key.position[1], key.position[2]],
      BackboneCameraBuilder.glToOpenCvRotation(BackboneCameraBuilder.quatToMat3([key.rotation[0], key.rotation[1], key.rotation[2], key.rotation[3]])),
    );
    expect(key.c2w).toEqual(c2w);
    const exported = buildBackboneCameraForClip(projectFor(saved), saved.id, [1920, 1080], { numFrames: 1 });
    expect(exported.fps).toBe(saved.time.fps);
    expect(exported.frames[0]?.c2w).toEqual(c2w);
    const off = step(saved, {
      type: "SET_CAMERA_TRACK_MAPPING",
      shotId: saved.id,
      mapping: { ...layersOf(saved), applyDriftCorrection: false },
    });
    const offTake = selectedTake(off);
    expect(offTake?.samples.map((sample) => sample.position)).toEqual(capture.samples.map((sample) => sample.position));
    const offFrames = resolveCameraTakeFrames(offTake as CameraTake, off);
    expect(offFrames[56]?.position[2]).toBeCloseTo(0.25, 6);
    expect(offFrames[0]?.position).toEqual([0, 2.5, 0]);
  });

  it("changes when a layer value changes and stays bitwise-identical when only ids change", async () => {
    const { shot } = await commitMobile();
    const take = selectedTake(shot);
    if (!take || shot.camera.status !== "ready") throw new Error("missing take");
    const original = resolveCameraTakeFrames(take, shot);
    const renamed: CameraTake = {
      ...take,
      id: "cam_01JC9Z3Q6N8V4R2T7K5M1XW0AB" as CameraTake["id"],
      name: "renamed",
      createdAt: "2026-01-01T00:00:00.000Z",
      legacyRefs: [{ kind: "camera_take", shotId: "other-shot", takeId: "take-old" }],
      calibration: { ...take.calibration, calibrationId: "cal_other", createdAt: "2026-02-02T00:00:00.000Z" },
    };
    const otherShot: Shot = { ...shot, id: shotId("clip-other"), name: "Other" };
    const same = resolveCameraTakeFrames(renamed, otherShot);
    expect(same).toEqual(original);
    expect(numberBits(same).equals(numberBits(original))).toBe(true);
    const moved = resolveCameraTakeFrames(take, shot, { frames: [0] });
    const scaled = resolveCameraTakeFrames({
      ...take,
      calibration: { ...take.calibration, translation: [0, 1.25, 0] },
    }, shot, { frames: [0] });
    expect(numberBits(scaled).equals(numberBits(moved))).toBe(false);
    const preserved = resolveCameraTakeFrames({
      ...take,
      mapping: { ...take.mapping, lossPolicy: "preserve" },
    }, shot, { frames: [35] });
    const held = resolveCameraTakeFrames(take, shot, { frames: [35] });
    expect(numberBits(preserved).equals(numberBits(held))).toBe(false);
    const noDrift = resolveCameraTakeFrames({
      ...take,
      mapping: { ...take.mapping, applyDriftCorrection: false },
    }, shot, { frames: [56] });
    const drifted = resolveCameraTakeFrames(take, shot, { frames: [56] });
    expect(numberBits(noDrift).equals(numberBits(drifted))).toBe(false);
    const gained = resolveCameraTakeFrames({
      ...take,
      mapping: { ...take.mapping, mode: "gain", translationGain: [0.5, 1, 1] },
    }, shot, { frames: [10] });
    const plain = resolveCameraTakeFrames(take, shot, { frames: [10] });
    expect(numberBits(gained).equals(numberBits(plain))).toBe(false);
  });

  it("applies calibration before drift, and drift off leaves the calibrated samples", () => {
    const samples = [
      { frame: 0, position: [1, 0, 0] as Vec3, rotation: [0, 0, 0, 1] as Quat, trackingState: "normal" as const },
      { frame: 1, position: [1, 0, 0] as Vec3, rotation: [0, 0, 0, 1] as Quat, trackingState: "normal" as const },
    ];
    const shot = emptyShot();
    const committed = step(shot, {
      type: "COMMIT_CAMERA_TAKE",
      shotId: shot.id,
      source: "record",
      keys: [
        { frame: 0, position: [1, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
        { frame: 1, position: [1, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
      ],
      samples,
      calibration: { ...identityCalibration(), scale: 2, method: "marker", residualRmsM: 0 },
      trackingEvents: [{
        kind: "drift_correction",
        frame: 1,
        estimatedDriftM: 1,
        correction: { translation: [0, 0, 1], rotation: [0, 0, 0, 1] },
      }],
      mapping: { ...identityMapping(), applyDriftCorrection: true },
    });
    const take = selectedTake(committed);
    if (!take) throw new Error("missing take");
    const frames = resolveCameraTakeFrames(take, committed, { frames: [1] });
    expect(frames[0]?.position[0]).toBeCloseTo(2, 6);
    expect(frames[0]?.position[2]).toBeCloseTo(1, 6);
    expect(take.samples[1]?.position).toEqual([1, 0, 0]);
    const off = step(committed, {
      type: "SET_CAMERA_TRACK_MAPPING",
      shotId: committed.id,
      mapping: { ...identityMapping(), applyDriftCorrection: false },
    });
    const offTake = selectedTake(off);
    const offFrames = resolveCameraTakeFrames(offTake as CameraTake, off, { frames: [1] });
    expect(offFrames[0]?.position).toEqual([2, 0, 0]);
    expect(offTake?.samples[1]?.position).toEqual([1, 0, 0]);
  });

  it("estimates drift from a re-observed reference point", () => {
    const calibration = identityCalibration();
    const event = estimateReferenceDrift({
      calibration,
      observations: [
        { frame: 0, devicePoint: [0, 0, 0], scenePoint: [0, 0, 0] },
        { frame: 10, devicePoint: [1, 0, 0.05], scenePoint: [1, 0, 0] },
      ],
    });
    expect(event?.estimatedDriftM).toBeCloseTo(0.05, 6);
    expect(event?.correction?.translation[2]).toBeCloseTo(-0.05, 6);
    expect(event?.frame).toBe(10);
  });
});

const layersOf = (shot: Shot) => {
  const take = selectedTake(shot);
  if (!take) throw new Error("missing take");
  return take.mapping;
};
