import { describe, it, expect } from "vitest";
import { BackboneCameraBuilder, BackbonePoseValidator } from "./backboneV01";
import type { CameraPathParams } from "../graph/cameraPath";
import type { LensParams } from "../graph/lens";

describe("Backbone v0.1 camera builder", () => {
  const lens: LensParams = { focalLengthMm: 36, sensorPreset: "full-frame" };
  const imageSize: [number, number] = [1280, 704];

  it("computes K from focal length and sensor preset", () => {
    const K = BackboneCameraBuilder.computeIntrinsicsK(lens, imageSize, "horizontal");
    // Sensor-fit horizontal with square pixels → fx == fy
    // For 36mm focal on full-frame width: fx = 36/36*1280 = 1280
    expect(Math.abs(K[0][0] - 1280)).toBeLessThan(1e-6);
    expect(Math.abs(K[1][1] - 1280)).toBeLessThan(1e-6);
    expect(K[0][2]).toBeCloseTo(imageSize[0] / 2, 6);
    expect(K[1][2]).toBeCloseTo(imageSize[1] / 2, 6);
  });

  it("converts GL camera orientation to OpenCV (identity → diag(1,-1,-1))", () => {
    const params: CameraPathParams = {
      keyframes: [
        {
          frame: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1], // identity quaternion
          focalLengthMm: 36,
        },
      ],
      interpolation: "linear",
      stabilization: 0,
      frameCount: 1,
    };
    const cam = BackboneCameraBuilder.buildFromCameraPath({ params, lens, imageSize, fps: 16, numFrames: 1 });
    expect(cam.frames.length).toBe(1);
    const m = cam.frames[0].c2w;
    // Expect rotation block equals diag(1,-1,-1)
    expect(m[0][0]).toBeCloseTo(1, 6);
    expect(m[1][1]).toBeCloseTo(-1, 6);
    expect(m[2][2]).toBeCloseTo(-1, 6);
    expect(m[0][1]).toBeCloseTo(0, 6);
    expect(m[0][2]).toBeCloseTo(0, 6);
    expect(m[1][0]).toBeCloseTo(0, 6);
    expect(m[2][0]).toBeCloseTo(0, 6);
  });

  it("uses Catmull-Rom for position interpolation when requested", () => {
    const params: CameraPathParams = {
      keyframes: [
        { frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
        { frame: 40, position: [10, 10, 0], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
        { frame: 80, position: [20, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
      ],
      interpolation: "catmull_rom",
      stabilization: 0,
      frameCount: 81,
    };
    const cam = BackboneCameraBuilder.buildFromCameraPath({ params, lens, imageSize, fps: 16, numFrames: 81 });
    // Sample mid-way between first two keyframes: frame 20
    const m = cam.frames.find((f) => f.t === 20)?.c2w!;
    const posY = m[1][3];
    const linearY = 5; // (0 → 10) at t=0.5
    // Catmull-Rom should deviate from strict linear interpolation when there is a following keyframe
    expect(Math.abs(posY - linearY)).toBeGreaterThan(1e-3);
    // Frames must be contiguous and match requested count.
    expect(cam.frames.length).toBe(81);
    expect(cam.frames[0].t).toBe(0);
    expect(cam.frames[80].t).toBe(80);
  });

  it("throws when no keyframes exist", () => {
    const params: CameraPathParams = {
      keyframes: [],
      interpolation: "linear",
      stabilization: 0,
      frameCount: 10,
    };
    expect(() =>
      BackboneCameraBuilder.buildFromCameraPath({ params, lens, imageSize, fps: 16, numFrames: 10 }),
    ).toThrow(/no camera keyframes/i);
  });

  it("fills metadata for look-at and continuity when present", () => {
    const params: CameraPathParams = {
      keyframes: [{ frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], focalLengthMm: 36 }],
      interpolation: "linear",
      stabilization: 0,
      frameCount: 1,
      label: "Shot A",
      lookAtTargetElementId: "actor-a",
      continuity: {
        lineOfActionLabel: "A→B",
        cameraSide: "left",
        screenDirection: "left_to_right",
      },
    };
    const cam = BackboneCameraBuilder.buildFromCameraPath({ params, lens, imageSize, fps: 16, numFrames: 1 });
    expect(cam.metadata?.label).toBe("Shot A");
    expect(cam.metadata?.lookAtTargetElementId).toBe("actor-a");
    expect(cam.metadata?.continuity?.lineOfActionLabel).toBe("A→B");
    expect(cam.metadata?.continuity?.cameraSide).toBe("left");
    expect(cam.metadata?.continuity?.screenDirection).toBe("left_to_right");
  });
});

describe("Backbone v0.1 SMPL-X pose schema", () => {
  it("validates correct SMPL-X shapes", () => {
    const valid = {
      version: "0.1",
      fps: 16,
      num_frames: 2,
      humans: [
        {
          id: "h0",
          model: "smplx",
          gender: "neutral",
          betas: Array(10).fill(0),
          frames: [
            {
              t: 0,
              global_orient: [0, 0, 0],
              transl: [0, 0, 0],
              body_pose: Array(63).fill(0),
              left_hand_pose: Array(45).fill(0),
              right_hand_pose: Array(45).fill(0),
              jaw_pose: [0, 0, 0],
              expression: Array(10).fill(0),
            },
            {
              t: 1,
              global_orient: [0.1, -0.2, 0.3],
              transl: [0.1, 0.2, 0.3],
              body_pose: Array(63).fill(0.01),
              left_hand_pose: Array(45).fill(0.02),
              right_hand_pose: Array(45).fill(0.03),
              jaw_pose: [0.01, 0.02, 0.03],
              expression: Array(10).fill(0.1),
            },
          ],
        },
      ],
      objects: [
        {
          id: "o0",
          asset_uri: "assets/chair.glb",
          scale: [1, 1, 1],
          frames: [{ t: 0, T_world_obj: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }],
        },
      ],
    };
    const parsed = BackbonePoseValidator.validatePose(valid);
    expect(parsed.humans[0].betas.length).toBe(10);
  });

  it("rejects invalid SMPL-X shapes", () => {
    const invalid = {
      version: "0.1",
      fps: 16,
      num_frames: 1,
      humans: [
        {
          id: "h0",
          model: "smplx",
          gender: "neutral",
          betas: Array(12).fill(0), // wrong length
          frames: [
            {
              t: 0,
              global_orient: [0, 0, 0],
              transl: [0, 0, 0],
              body_pose: Array(63).fill(0),
              left_hand_pose: Array(45).fill(0),
              right_hand_pose: Array(45).fill(0),
              jaw_pose: [0, 0, 0],
              expression: Array(10).fill(0),
            },
          ],
        },
      ],
    };
    expect(() => BackbonePoseValidator.validatePose(invalid)).toThrow();
  });
});

