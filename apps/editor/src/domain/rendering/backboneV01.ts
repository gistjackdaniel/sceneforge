import { z } from "zod";
import type { CameraPathParams, CameraKeyframe } from "../graph/cameraPath";
import { interpolateCameraPose } from "../graph/cameraPath";
import type { LensParams, SensorPreset } from "../graph/lens";

/**
 * Backbone v0.1 camera trajectory schema (single-shot MVP).
 * - World: right-handed, Y-up, meters
 * - Camera: OpenCV convention (x right, y down, z forward)
 * - Per-frame K (pixels), c2w (4x4), near/far, explicit fps and num_frames
 */
export const mat3Schema = z
  .array(z.array(z.number()))
  .refine((rows) => rows.length === 3 && rows.every((r) => r.length === 3), "K must be 3x3");

export const mat4Schema = z
  .array(z.array(z.number()))
  .refine((rows) => rows.length === 4 && rows.every((r) => r.length === 4), "Matrix must be 4x4");

export const backboneCameraFrameSchema = z.object({
  t: z.number().int().nonnegative(),
  K: mat3Schema,
  c2w: mat4Schema,
  near: z.number().positive().default(0.05),
  far: z.number().positive().default(100.0),
});

export const backboneCameraSchema = z.object({
  version: z.literal("0.1"),
  fps: z.number().positive().default(16),
  num_frames: z.number().int().positive().default(81),
  image_size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  convention: z.literal("opencv_c2w"),
  frames: z.array(backboneCameraFrameSchema).min(1),
  metadata: z
    .object({
      label: z.string().optional(),
      lookAtTargetElementId: z.string().optional(),
      continuity: z
        .object({
          lineOfActionLabel: z.string(),
          cameraSide: z.enum(["left", "right", "unlocked"]),
          screenDirection: z.enum(["left_to_right", "right_to_left", "neutral"]),
        })
        .optional(),
    })
    .optional(),
});
export type BackboneCamera = z.infer<typeof backboneCameraSchema>;

/**
 * Backbone v0.1 pose trajectory schema — SMPL-X only for MVP.
 * - betas: 10 fixed per shot
 * - axis-angle radians, world coordinates
 * - hand pose: 45 each, no PCA
 */
const vectorN = (n: number) => z.array(z.number()).length(n);
const mat4x4 = () => mat4Schema;

export const backboneSmplxFrameSchema = z.object({
  t: z.number().int().nonnegative(),
  global_orient: vectorN(3),
  transl: vectorN(3),
  body_pose: vectorN(63),
  left_hand_pose: vectorN(45),
  right_hand_pose: vectorN(45),
  jaw_pose: vectorN(3),
  expression: vectorN(10),
});

export const backboneHumanPoseSchema = z.object({
  id: z.string().min(1),
  model: z.literal("smplx"),
  gender: z.enum(["neutral", "male", "female"]).default("neutral"),
  betas: vectorN(10),
  frames: z.array(backboneSmplxFrameSchema).min(1),
});

export const backboneObjectPoseSchema = z.object({
  id: z.string().min(1),
  asset_uri: z.string().min(1),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  frames: z.array(
    z.object({
      t: z.number().int().nonnegative(),
      T_world_obj: mat4x4(),
    }),
  ),
});

export const backbonePoseSchema = z.object({
  version: z.literal("0.1"),
  fps: z.number().positive().default(16),
  num_frames: z.number().int().positive().default(81),
  humans: z.array(backboneHumanPoseSchema).default([]),
  objects: z.array(backboneObjectPoseSchema).default([]),
});
export type BackbonePose = z.infer<typeof backbonePoseSchema>;

/**
 * Utilities to build Backbone v0.1 camera trajectories from editor state.
 */
export class BackboneCameraBuilder {
  static SENSOR_SIZE_MM: Record<SensorPreset, { width: number; height: number }> = {
    "full-frame": { width: 36, height: 24 },
    super35: { width: 24, height: 13.5 },
    "micro-four-thirds": { width: 17.3, height: 13 },
  };

  /**
   * Convert Lens (focal in mm, sensor preset) + image size to intrinsics K in pixels.
   * Uses a single focal length in pixels (square pixels) with a sensor-fit rule.
   * - fit = 'horizontal' (default): fx_base = f / sensorWidth * widthPx
   * - fit = 'vertical'            : fy_base = f / sensorHeight * heightPx
   * - fit = 'auto'                : choose dimension with larger px/mm ratio (Blender AUTO-like)
   */
  static computeIntrinsicsK(
    lens: LensParams,
    imageSize: [number, number],
    fit: "horizontal" | "vertical" | "auto" = "horizontal",
  ): [[number, number, number], [number, number, number], [number, number, number]] {
    const sensor = BackboneCameraBuilder.SENSOR_SIZE_MM[lens.sensorPreset ?? "full-frame"];
    const [widthPx, heightPx] = imageSize;
    const f = Math.max(1e-6, lens.focalLengthMm);
    const fxBase = (f / sensor.width) * widthPx;
    const fyBase = (f / sensor.height) * heightPx;
    let fpx: number;
    if (fit === "auto") {
      // Choose the dimension with larger px/mm (tighter fit), like Blender AUTO.
      const pxPerMmX = widthPx / sensor.width;
      const pxPerMmY = heightPx / sensor.height;
      fpx = pxPerMmX >= pxPerMmY ? fxBase : fyBase;
    } else if (fit === "vertical") {
      fpx = fyBase;
    } else {
      fpx = fxBase;
    }
    const fx = fpx;
    const fy = fpx;
    const cx = widthPx / 2;
    const cy = heightPx / 2;
    return [
      [fx, 0, cx],
      [0, fy, cy],
      [0, 0, 1],
    ];
  }

  /**
   * Quaternion [x, y, z, w] → 3×3 rotation matrix.
   */
  static quatToMat3(q: [number, number, number, number]): number[][] {
    const [x, y, z, w] = q;
    const xx = x * x,
      yy = y * y,
      zz = z * z;
    const xy = x * y,
      xz = x * z,
      yz = y * z;
    const wx = w * x,
      wy = w * y,
      wz = w * z;
    return [
      [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
      [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
      [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
    ];
  }

  /**
   * Apply OpenGL/Blender( y up, -z forward ) → OpenCV( y down, +z forward )
   * conversion on the camera-side by post-multiplying diag(1, -1, -1).
   * R_cv = R_gl · S, where S = diag(1, -1, -1).
   */
  static glToOpenCvRotation(Rgl: number[][]): number[][] {
    // Post-multiply by S: flip Y/Z columns.
    return [
      [Rgl[0][0], -Rgl[0][1], -Rgl[0][2]],
      [Rgl[1][0], -Rgl[1][1], -Rgl[1][2]],
      [Rgl[2][0], -Rgl[2][1], -Rgl[2][2]],
    ];
  }

  static composeC2W(position: [number, number, number], Rcv: number[][]): number[][] {
    return [
      [Rcv[0][0], Rcv[0][1], Rcv[0][2], position[0]],
      [Rcv[1][0], Rcv[1][1], Rcv[1][2], position[1]],
      [Rcv[2][0], Rcv[2][1], Rcv[2][2], position[2]],
      [0, 0, 0, 1],
    ];
  }

  /**
   * Build Backbone camera trajectory frames (0-indexed) by sampling/interpolating the camera path.
   * - Rotation between keyframes uses slerp
   * - Position uses linear or Catmull-Rom based on params.interpolation
   */
  static buildFromCameraPath(options: {
    params: CameraPathParams;
    lens: LensParams;
    imageSize: [number, number];
    fps?: number;
    numFrames?: number;
    near?: number;
    far?: number;
    sensorFit?: "horizontal" | "vertical" | "auto";
  }): BackboneCamera {
    const fps = options.fps ?? 16;
    const numFrames = Math.max(1, Math.floor(options.numFrames ?? options.params.frameCount ?? 81));
    const near = options.near ?? 0.05;
    const far = options.far ?? 100.0;
    const K = BackboneCameraBuilder.computeIntrinsicsK(options.lens, options.imageSize, options.sensorFit ?? "horizontal");
    const frames: Array<z.infer<typeof backboneCameraFrameSchema>> = [];
    let lastPose: CameraKeyframe | undefined;
    if (!options.params.keyframes || options.params.keyframes.length === 0) {
      throw new Error("BackboneCameraBuilder: no camera keyframes available to build trajectory.");
    }
    for (let t = 0; t < numFrames; t += 1) {
      const pose: CameraKeyframe | undefined = interpolateCameraPose(options.params, t) ?? lastPose;
      if (!pose) {
        throw new Error(`BackboneCameraBuilder: cannot resolve camera pose at frame ${t}.`);
      }
      const Rgl = BackboneCameraBuilder.quatToMat3(pose.rotation);
      const Rcv = BackboneCameraBuilder.glToOpenCvRotation(Rgl);
      const c2w = BackboneCameraBuilder.composeC2W(pose.position, Rcv);
      frames.push({
        t,
        K,
        c2w,
        near,
        far,
      });
      lastPose = pose;
    }
    const result: BackboneCamera = {
      version: "0.1" as const,
      fps,
      num_frames: frames.length, // guaranteed == numFrames
      image_size: options.imageSize,
      convention: "opencv_c2w" as const,
      frames,
      metadata: {
        label: options.params.label,
        lookAtTargetElementId: options.params.lookAtTargetElementId,
        continuity: options.params.continuity && {
          lineOfActionLabel: options.params.continuity.lineOfActionLabel,
          cameraSide: options.params.continuity.cameraSide,
          screenDirection: options.params.continuity.screenDirection,
        },
      },
    };
    return backboneCameraSchema.parse(result);
  }
}

/**
 * Utilities to validate Backbone v0.1 SMPL-X pose payloads.
 */
export class BackbonePoseValidator {
  static validatePose(pose: unknown): BackbonePose {
    return backbonePoseSchema.parse(pose);
  }
}

