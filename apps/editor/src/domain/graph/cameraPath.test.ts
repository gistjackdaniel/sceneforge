import { describe, expect, it } from "vitest";
import { cameraPoseAtFrame, defaultCameraPathParams, upsertCameraKeyframe } from "./cameraPath";
import { isCameraMotionKind, isObjectMotionKind } from "./motion";
import { topologicalSort } from "./topoSort";

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
