import { describe, expect, it } from "vitest";
import {
  activeCameraTake,
  cameraPathParamsFromNode,
  cameraPoseAtFrame,
  commitCameraTake,
  defaultCameraPathParams,
  deleteCameraKeyframe,
  deleteCameraTake,
  interpolateCameraPose,
  isFrameInsideClip,
  keyframeAtExactFrame,
  nextKeyframeFrame,
  previousKeyframeFrame,
  selectCameraTake,
  trimKeyframesToDuration,
  upsertCameraKeyframe,
} from "./cameraPath";
import { isCameraMotionKind, isObjectMotionKind } from "./motion";
import { topologicalSort } from "./topoSort";
import { buildRigPreset } from "./cameraRig";
import { lensParamsFromNode } from "./lens";

describe("camera path", () => {
  it("stores keyframes separately from object motion kinds", () => {
    expect(isCameraMotionKind("CameraPathNode")).toBe(true);
    expect(isObjectMotionKind("CameraPathNode")).toBe(false);
    expect(isObjectMotionKind("ObjectTrajectoryNode")).toBe(true);

    const withKf = upsertCameraKeyframe(defaultCameraPathParams(), {
      frame: 12,
      position: [1, 1.6, 3],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    expect(cameraPoseAtFrame(withKf, 12)?.position).toEqual([1, 1.6, 3]);
    expect(withKf.keyframes).toHaveLength(1);
  });

  it("replaces a colliding frame instead of storing two keyframes", () => {
    const first = upsertCameraKeyframe(defaultCameraPathParams(), {
      frame: 10,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    const second = upsertCameraKeyframe(first, {
      frame: 10,
      position: [2, 2, 2],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 50,
    });
    expect(second.keyframes).toHaveLength(1);
    expect(keyframeAtExactFrame(second, 10)?.position).toEqual([2, 2, 2]);
  });

  it("navigates previous/next keyframes and trims frames outside clip duration", () => {
    let params = defaultCameraPathParams();
    [0, 24, 48, 200].forEach((frame) => {
      params = upsertCameraKeyframe(params, {
        frame,
        position: [frame / 10, 1, 2],
        rotation: [0, 0, 0, 1],
        focalLengthMm: 35,
      });
    });
    expect(previousKeyframeFrame(params, 24)).toBe(0);
    expect(nextKeyframeFrame(params, 24)).toBe(48);
    expect(isFrameInsideClip(200, 120)).toBe(false);
    const trimmed = trimKeyframesToDuration(params, 120);
    expect(trimmed.removed).toBe(1);
    expect(trimmed.params.keyframes.map((item) => item.frame)).toEqual([0, 24, 48]);
    expect(deleteCameraKeyframe(trimmed.params, 24).keyframes).toHaveLength(2);
  });

  it("interpolates between keyframes for path visualization", () => {
    let params = defaultCameraPathParams();
    params = upsertCameraKeyframe(params, {
      frame: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    params = upsertCameraKeyframe(params, {
      frame: 10,
      position: [10, 0, 0],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    expect(interpolateCameraPose(params, 5)?.position[0]).toBeCloseTo(5);
  });

  it("migrates legacy keyframes into Take 1 and keeps active keyframes mirrored", () => {
    const migrated = cameraPathParamsFromNode({
      keyframes: [
        { frame: 0, position: [0, 1, 2], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
        { frame: 12, position: [1, 1, 2], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
      ],
      interpolation: "linear",
    });
    expect(migrated.takes).toHaveLength(1);
    expect(migrated.activeTakeId).toBe("take-1");
    expect(migrated.keyframes).toHaveLength(2);
    expect(activeCameraTake(migrated)?.name).toBe("Take 1");
  });

  it("commits Record takes separately and Generate uses the selected take", () => {
    const first = commitCameraTake(defaultCameraPathParams(), {
      source: "record",
      keyframes: [
        { frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
        { frame: 1, position: [1, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const second = commitCameraTake(first, {
      source: "record",
      keyframes: [
        { frame: 0, position: [9, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 50 },
        { frame: 1, position: [8, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 50 },
      ],
      createdAt: "2026-01-01T00:01:00.000Z",
    });
    expect(second.takes.map((take) => take.name)).toEqual(["Take 1", "Take 2"]);
    expect(second.keyframes[0]?.position).toEqual([9, 0, 0]);
    const selected = selectCameraTake(second, "take-1");
    expect(selected.keyframes[0]?.position).toEqual([0, 0, 0]);
    expect(deleteCameraTake(second, "take-2").takes).toHaveLength(1);
  });

  it("writes K poses into the active take", () => {
    const stamped = upsertCameraKeyframe(defaultCameraPathParams(), {
      frame: 4,
      position: [0, 1.5, 3],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    expect(stamped.takes).toHaveLength(1);
    expect(stamped.takes[0].source).toBe("manual");
    expect(stamped.keyframes).toHaveLength(1);
  });
});

describe("camera rig presets", () => {
  it("writes CameraRigNode params and path keyframes, not a model-named node", () => {
    const built = buildRigPreset({
      preset: "dolly_in",
      durationFrames: 48,
      start: { position: [2.5, 1.8, 3.2], rotation: [0, 0, 0] },
    });
    expect(built.rig.preset).toBe("dolly_in");
    expect(built.keyframes.length).toBeGreaterThanOrEqual(2);
    expect(isCameraMotionKind("CameraRigNode")).toBe(true);
    expect(isCameraMotionKind("LyraNode")).toBe(false);
  });
});

describe("lens params", () => {
  it("reads focal length and aperture from LensNode without using camera transform fields", () => {
    const lens = lensParamsFromNode({ focalLength: 50, aperture: 2.8, sensorPreset: "full-frame" });
    expect(lens.focalLengthMm).toBe(50);
    expect(lens.aperture).toBe(2.8);
    expect(lens.sensorPreset).toBe("full-frame");
  });
});

describe("topologicalSort", () => {
  it("returns a stable order for a DAG", () => {
    const result = topologicalSort(["c", "a", "b"], [
      {
        id: "e1",
        sourceNodeId: "a",
        sourcePort: "out",
        targetNodeId: "b",
        targetPort: "in",
        kind: "data",
      },
      {
        id: "e2",
        sourceNodeId: "b",
        sourcePort: "out",
        targetNodeId: "c",
        targetPort: "in",
        kind: "data",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(["a", "b", "c"]);
  });
});
