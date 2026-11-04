import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBackboneCameraForClip } from "../../application/services/backboneExport";
import { commitInputFromCapture } from "../../application/services/cameraCapture";
import { BackboneCameraBuilder } from "../rendering/backboneV01";
import type { Project } from "../project/types";
import { defaultPorts, type NodeBase } from "./types";
import { resolveAuthoringFps } from "./authoringFps";
import {
  cameraPathParamsFromNode,
  commitCameraTake,
  defaultCameraPathParams,
  recordedTakePlaybackPoses,
  viewportPlaybackPoses,
  withCameraTrackMapping,
  type CameraPathParams,
} from "./cameraPath";
import {
  CameraTrackInputError,
  createFixtureCameraTrackAdapter,
  identityMapping,
  readCameraTrackCapture,
  type CameraTrackCapture,
} from "./cameraTrack";
import {
  eulerToQuaternionXYZ,
  eulerToQuaternionZYX,
  multiplyQuat,
  quaternionAngleRadians,
  viewportShotQuaternion,
} from "./cameraRotation";

const now = "2026-11-04T00:00:00.000Z";
const takeId = "cam_01JC9Z3Q6N8V4R2T7K5M1XW0AB";

const phoneFixture = (): CameraTrackCapture => ({
  authoredFps: 24,
  calibration: {
    calibrationId: "cal_01JC9Z3Q6N8V4R2T7K5M1XW0AB",
    arFramework: "arkit",
    scale: 2,
    rotation: [0, 0, 0, 1],
    translation: [0, 1, 0],
    method: "manual_anchor",
    residualRmsM: 0.01,
    createdAt: now,
  },
  intrinsics: {
    imageSize: [1920, 1080],
    K: [
      [1500, 0, 960],
      [0, 1500, 540],
      [0, 0, 1],
    ],
    focalLengthMm: 26,
    sensorSizeMm: [36, 24],
    sensorFit: "horizontal",
    distortion: [0.01, -0.002, 0, 0, 0],
  },
  trackingEvents: [
    { kind: "tracking_lost", frame: 8, deviceTimestampNs: 333_333_333, estimatedDriftM: 0.05 },
    {
      kind: "drift_correction",
      frame: 12,
      deviceTimestampNs: 500_000_000,
      correction: { translation: [0.01, 0, 0], rotation: [0, 0, 0, 1] },
      estimatedDriftM: 0.02,
    },
  ],
  samples: [
    {
      frame: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      deviceTimestampNs: 0,
      timecode: "00:00:00:00",
      trackingState: "normal",
      focalLengthMm: 26,
    },
    {
      frame: 24,
      position: [2, 0, 0],
      rotation: [0, 0, 0, 1],
      deviceTimestampNs: 1_000_000_000,
      timecode: "00:00:01:00",
      trackingState: "limited",
      focalLengthMm: 26,
    },
  ],
});

const closeQuat = (actual: [number, number, number, number], expected: [number, number, number, number]) => {
  expect(quaternionAngleRadians(actual, expected)).toBeLessThan(1e-6);
};

const projectWithPath = (params: CameraPathParams, sequenceFps?: number): Project => {
  const ports = defaultPorts();
  const node = (id: string, kind: NodeBase["kind"], parameters: Record<string, unknown>): NodeBase => ({
    id,
    name: id,
    kind,
    type: kind,
    category: "cinematic",
    scope: "clip",
    enabled: true,
    tags: [],
    version: 1,
    referenceType: "local",
    parameters,
    params: parameters,
    downstreamNodeIds: [],
    status: "clean",
    inputPorts: ports.inputPorts,
    outputPorts: ports.outputPorts,
    createdAt: now,
    updatedAt: now,
  });
  return {
    id: "p1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    sequences: {
      "seq-1": {
        id: "seq-1",
        name: "Main",
        clipIds: ["clip-a"],
        playhead: 0,
        visibleRange: [0, 48],
        ...(sequenceFps ? { fps: sequenceFps } : {}),
      },
    },
    clips: {
      "clip-a": {
        id: "clip-a",
        name: "A",
        start: 0,
        end: 25,
        duration: 25,
        startFrame: 0,
        durationFrames: 25,
        sourceType: "empty",
        clipGraphId: "g-a",
        cameraPathNodeId: "node-clip-a-trajectory",
        cacheStatus: "valid",
      },
    },
    clipGraphs: {
      "g-a": {
        id: "g-a",
        clipId: "clip-a",
        rootNodeId: "render",
        nodeIds: ["render", "node-clip-a-trajectory", "node-clip-a-lens"],
        edges: [],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      render: node("render", "RenderSettingsNode", {}),
      "node-clip-a-trajectory": node("node-clip-a-trajectory", "CameraPathNode", { ...params }),
      "node-clip-a-lens": node("node-clip-a-lens", "LensNode", { focalLengthMm: 35, sensorPreset: "full-frame" }),
    },
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};

describe("camera track roundtrip", () => {
  it("reproduces the same path from saved scene state for viewport playback and the recorded take", async () => {
    const capture = await readCameraTrackCapture(createFixtureCameraTrackAdapter(phoneFixture()));
    const committed = commitCameraTake(
      defaultCameraPathParams(),
      commitInputFromCapture(capture, { source: "record", id: takeId, createdAt: now }),
    );
    const loaded = cameraPathParamsFromNode(JSON.parse(JSON.stringify(committed)));
    const reloaded = cameraPathParamsFromNode(JSON.parse(JSON.stringify(loaded)));
    const take = loaded.takes[0];
    expect(take?.id).toBe(takeId);
    expect(take?.samples[0]?.timecode).toBe("00:00:00:00");
    expect(take?.samples[1]?.trackingState).toBe("limited");
    expect(take?.trackingEvents).toEqual(phoneFixture().trackingEvents);
    expect(take?.intrinsics?.K).toEqual(phoneFixture().intrinsics?.K);
    expect(take?.intrinsics?.distortion).toEqual([0.01, -0.002, 0, 0, 0]);
    expect(take?.calibration.scale).toBe(2);
    expect(take?.keyframes[0]?.position).toEqual([0, 1, 0]);
    expect(take?.keyframes[1]?.position).toEqual([4, 1, 0]);

    const viewport = viewportPlaybackPoses(loaded, 25);
    const recorded = recordedTakePlaybackPoses(take!, 25, loaded.interpolation);
    expect(viewport).toHaveLength(25);
    viewport.forEach((pose, frame) => {
      const replay = recorded[frame];
      expect(replay?.position[0]).toBeCloseTo(pose.position[0], 6);
      expect(replay?.position[1]).toBeCloseTo(pose.position[1], 6);
      expect(replay?.position[2]).toBeCloseTo(pose.position[2], 6);
      closeQuat(replay!.rotation, pose.rotation);
      closeQuat(viewportShotQuaternion({ quaternion: pose.rotation, rotation: [9, 9, 9] }), pose.rotation);
    });
    expect(viewport[0]?.position).toEqual([0, 1, 0]);
    expect(viewport[12]?.position[0]).toBeCloseTo(2, 6);
    expect(viewport[12]?.position[1]).toBeCloseTo(1, 6);
    expect(viewport[24]?.position).toEqual([4, 1, 0]);

    const again = viewportPlaybackPoses(reloaded, 25);
    again.forEach((pose, frame) => {
      expect(pose.position).toEqual(viewport[frame]?.position);
      closeQuat(pose.rotation, viewport[frame]!.rotation);
    });

    const project = projectWithPath(loaded);
    const fps = resolveAuthoringFps({
      shot: project.clips["clip-a"],
      sequence: project.sequences["seq-1"],
    });
    const exported = buildBackboneCameraForClip(project, "clip-a", [1280, 720], { numFrames: 25 });
    expect(exported.fps).toBe(fps);
    expect(exported.fps).toBe(24);
    expect(exported.convention).toBe("opencv_c2w");
    viewport.forEach((pose, frame) => {
      const c2w = BackboneCameraBuilder.composeC2W(
        pose.position,
        BackboneCameraBuilder.glToOpenCvRotation(BackboneCameraBuilder.quatToMat3(pose.rotation)),
      );
      c2w.forEach((row, rowIndex) => {
        row.forEach((value, column) => {
          expect(exported.frames[frame]?.c2w[rowIndex]?.[column]).toBeCloseTo(value, 6);
        });
      });
    });
  });

  it("keeps the original samples when a gain mapping changes the virtual camera", async () => {
    const capture = await readCameraTrackCapture(createFixtureCameraTrackAdapter(phoneFixture()));
    const committed = commitCameraTake(
      defaultCameraPathParams(),
      commitInputFromCapture(capture, { source: "record", id: takeId, createdAt: now }),
    );
    const samples = committed.takes[0]?.samples;
    const mapped = withCameraTrackMapping(committed, takeId, {
      ...identityMapping(),
      mode: "gain",
      translationGain: [0.5, 1, 1],
    });
    expect(mapped.takes[0]?.samples).toBe(samples);
    expect(mapped.takes[0]?.samples[1]?.position).toEqual([2, 0, 0]);
    expect(mapped.takes[0]?.keyframes[1]?.position[0]).toBeCloseTo(2, 6);
    expect(mapped.takes[0]?.keyframes[1]?.position[1]).toBeCloseTo(1, 6);
    expect(mapped.takes[0]?.keyframes[0]?.position).toEqual([0, 1, 0]);
  });

  it("applies a device rotation with the same quaternion product the viewport uses", () => {
    const deviceEuler = new THREE.Euler(-0.2, 0.4, 0.3, "XYZ");
    const device = new THREE.Quaternion().setFromEuler(deviceEuler);
    const calibration = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, "XYZ"));
    const deviceQuat: [number, number, number, number] = [device.x, device.y, device.z, device.w];
    const calibrationQuat: [number, number, number, number] = [calibration.x, calibration.y, calibration.z, calibration.w];
    const expected = calibration.clone().multiply(device);
    const committed = commitCameraTake(defaultCameraPathParams(), {
      source: "record",
      createdAt: now,
      id: takeId,
      keyframes: [],
      calibration: {
        calibrationId: "cal_01JC9Z3Q6N8V4R2T7K5M1XW0AB",
        arFramework: "arkit",
        scale: 1,
        rotation: calibrationQuat,
        translation: [0, 0, 0],
        method: "marker",
        createdAt: now,
      },
      samples: [
        {
          frame: 0,
          position: [1, 0, 0],
          rotation: deviceQuat,
          trackingState: "normal",
          deviceTimestampNs: 0,
        },
      ],
    });
    const pose = committed.keyframes[0];
    closeQuat(pose!.rotation, [expected.x, expected.y, expected.z, expected.w]);
    closeQuat(pose!.rotation, multiplyQuat(calibrationQuat, deviceQuat));
    const point = new THREE.Vector3(1, 0, 0).applyQuaternion(calibration);
    expect(pose?.position[0]).toBeCloseTo(point.x, 6);
    expect(pose?.position[1]).toBeCloseTo(point.y, 6);
    expect(pose?.position[2]).toBeCloseTo(point.z, 6);
    closeQuat(committed.takes[0]!.samples[0]!.rotation, deviceQuat);
  });

  it("migrates a ZYX-encoded take once so the stored quaternion matches the viewport", () => {
    const euler: [number, number, number] = [-0.3, 0.8, 0.1];
    const legacy = eulerToQuaternionZYX(euler);
    const viewport = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], "XYZ"));
    expect((quaternionAngleRadians(legacy, eulerToQuaternionXYZ(euler)) * 180) / Math.PI).toBeCloseTo(14.1, 1);
    const loaded = cameraPathParamsFromNode({
      keyframes: [{ frame: 0, position: [0, 1, 2], rotation: legacy, focalLengthMm: 35 }],
    });
    const stored = loaded.keyframes[0]?.rotation;
    expect(stored).toBeTruthy();
    expect(new THREE.Quaternion(stored![0], stored![1], stored![2], stored![3]).angleTo(viewport)).toBeLessThan(1e-6);
    expect(loaded.activeTakeId).toBe("take-1");
    expect(loaded.rotationStorage).toBe("quaternion_xyzw");
    closeQuat(loaded.takes[0]!.samples[0]!.rotation, stored!);
    const twice = cameraPathParamsFromNode(JSON.parse(JSON.stringify(loaded)));
    closeQuat(twice.keyframes[0]!.rotation, stored!);
    const trusted = commitCameraTake(defaultCameraPathParams(), {
      source: "manual",
      createdAt: now,
      keyframes: [{ frame: 0, position: [0, 0, 0], rotation: eulerToQuaternionXYZ(euler), focalLengthMm: 35 }],
    });
    const reloaded = cameraPathParamsFromNode(JSON.parse(JSON.stringify(trusted)));
    closeQuat(reloaded.keyframes[0]!.rotation, eulerToQuaternionXYZ(euler));
  });

  it("rejects a capture that does not match the contract and a cancelled read", async () => {
    const adapter = createFixtureCameraTrackAdapter(phoneFixture());
    const controller = new AbortController();
    controller.abort();
    await expect(readCameraTrackCapture(adapter, controller.signal)).rejects.toBeInstanceOf(CameraTrackInputError);
    await expect(
      readCameraTrackCapture(
        createFixtureCameraTrackAdapter({
          authoredFps: 0,
          samples: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] }],
        }),
      ),
    ).rejects.toBeInstanceOf(CameraTrackInputError);
  });
});
