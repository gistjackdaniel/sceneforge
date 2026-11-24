import { z } from "zod";
import { WorldDomainError } from "./errors";
import type { WorldAsset, WorldFrontAxis, WorldHandedness } from "./types";

/**
 * Integer frame on the shot-local clock. Seconds are `frame / Shot.time.fps`.
 * This module does not store fps and does not fill a default.
 * The single source is `Shot.time.fps` in `domain/shot`.
 */
export type ShotLocalFrame = number;

/**
 * Structural clock. Matches `Shot.time`. Callers read `fps` from the shot;
 * world documents do not copy it.
 */
export type ShotTimeSource = {
  fps: number;
  durationFrames: number;
};

/**
 * Names the shot whose clock is `Shot.time.fps`.
 * This ref does not copy fps.
 */
export type ShotFpsRef = {
  shotId: string;
};

/** Read the single fps. The number stays on the shot. */
export const shotFps = (shot: { time: ShotTimeSource }): number => {
  if (!(shot.time.fps > 0) || !Number.isFinite(shot.time.fps)) {
    throw new WorldDomainError("invalid_fps", "Shot.time.fps must be positive.");
  }
  return shot.time.fps;
};

/**
 * Canonical scene frame. `timeBase` counts integer frames and is divided by `Shot.time.fps`.
 * Source files keep their own axes on `WorldAsset`
 * (`coordinateSystem`, `unitScaleMeters`, `handedness`, `frontAxis`) and on
 * each asset revision's `sourceAxes`. Import converts them into this frame once.
 *
 * Camera samples themselves belong to the Scene lane. This contract only names
 * the frames those samples must use: GL locally, OpenCV when exported.
 */
export const SCENE_COORDINATE_CONTRACT = {
  handedness: "right",
  upAxis: "Y",
  forwardAxis: "+Z",
  unit: "meter",
  metersPerUnit: 1,
  cameraLocalFrame: "gl",
  exportCameraFrame: "opencv",
  rotationStorage: "quaternion_xyzw",
  matrixLayout: "row_major_nested",
  timeBase: "shot_local_frame",
} as const;

export const sceneCoordinateContractSchema = z.object({
  handedness: z.literal("right"),
  upAxis: z.literal("Y"),
  forwardAxis: z.literal("+Z"),
  unit: z.literal("meter"),
  metersPerUnit: z.literal(1),
  cameraLocalFrame: z.literal("gl"),
  exportCameraFrame: z.literal("opencv"),
  rotationStorage: z.literal("quaternion_xyzw"),
  matrixLayout: z.literal("row_major_nested"),
  timeBase: z.literal("shot_local_frame"),
});

export type SceneCoordinateContract = z.infer<typeof sceneCoordinateContractSchema>;

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const vec3Schema = vec3;

/** Unit quaternion `[x, y, z, w]`, the `THREE.Quaternion` component order. Euler angles are not stored. */
export const quatSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-4, "quaternion must be unit length");

/** Parent-local TRS in meters. Rotation is a quaternion. */
export const transformSchema = z.object({
  translation: vec3Schema,
  rotation: quatSchema,
  scale: vec3Schema.default([1, 1, 1]),
});

export type Transform = z.infer<typeof transformSchema>;

export const IDENTITY_TRANSFORM: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

const mat4Row = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

/** 4x4 row-major matrix, `rows[r][c]`, matching `backboneV01` `mat4Schema`. */
export const mat4Schema = z.tuple([mat4Row, mat4Row, mat4Row, mat4Row]);

export type Mat4 = z.infer<typeof mat4Schema>;

export const frontAxisSchema = z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]);

/**
 * Axes of a source file before it was converted into the canonical scene.
 * `WorldAsset.coordinateSystem` is `upAxis`. `WorldAsset.unitScaleMeters` is `metersPerUnit`.
 */
export const sourceAxesSchema = z
  .object({
    upAxis: z.enum(["Y", "Z"]),
    handedness: z.enum(["right", "left"]).default("right"),
    frontAxis: frontAxisSchema.default("+Z"),
    metersPerUnit: z.number().positive(),
    importTransform: mat4Schema.optional(),
  })
  .superRefine((axes, ctx) => {
    if (axes.frontAxis.endsWith(axes.upAxis)) {
      ctx.addIssue({
        code: "custom",
        message: "front axis is parallel to the up axis",
        path: ["frontAxis"],
      });
    }
  });

export type SourceAxes = z.infer<typeof sourceAxesSchema>;

export const DEFAULT_HANDEDNESS: WorldHandedness = "right";

/**
 * Forward axis used when a legacy world does not record one.
 * Z-up defaults to -Y so the conversion into Y-up/+Z is a rotation, not a mirror.
 * Blender's Z-up/-Y front matches this. A source that faces +Y must set `frontAxis` explicitly.
 */
export const defaultFrontAxis = (coordinateSystem: WorldAsset["coordinateSystem"]): WorldFrontAxis =>
  coordinateSystem === "Z_UP" ? "-Y" : "+Z";

type Vec3 = [number, number, number];

const parseAxis = (axis: WorldFrontAxis): { index: 0 | 1 | 2; sign: 1 | -1 } => {
  const sign = axis.startsWith("-") ? -1 : 1;
  const letter = axis.slice(1);
  const index = letter === "X" ? 0 : letter === "Y" ? 1 : 2;
  return { index, sign };
};

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const scaleVec = (vector: Vec3, scale: number): Vec3 => [
  vector[0] * scale,
  vector[1] * scale,
  vector[2] * scale,
];

/**
 * Row-major transform that maps source coordinates into the canonical scene
 * (right-handed, Y-up, +Z forward, meters).
 * A right-handed source keeps a proper rotation (determinant +scale^3).
 * A left-handed source mirrors the remaining axis.
 * Downstream importers should apply this once and keep the source axes as a record.
 */
export const buildImportTransform = (input: {
  upAxis: "Y" | "Z";
  handedness: WorldHandedness;
  frontAxis: WorldFrontAxis;
  metersPerUnit: number;
}): Mat4 => {
  if (!(input.metersPerUnit > 0) || !Number.isFinite(input.metersPerUnit)) {
    throw new WorldDomainError("invalid_unit", "Source metersPerUnit must be positive.");
  }
  const up = parseAxis(input.upAxis === "Y" ? "+Y" : "+Z");
  const forward = parseAxis(input.frontAxis);
  if (up.index === forward.index) {
    throw new WorldDomainError("invalid_axes", "Front axis is parallel to the up axis.");
  }
  const columns: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  columns[up.index] = [0, up.sign, 0];
  columns[forward.index] = [0, 0, forward.sign];
  const missing = ([0, 1, 2] as const).find((index) => index !== up.index && index !== forward.index);
  if (missing === undefined) {
    throw new WorldDomainError("invalid_axes", "Source axes are incomplete.");
  }
  let right: Vec3;
  if (missing === 0) right = cross(columns[1]!, columns[2]!);
  else if (missing === 1) right = cross(columns[2]!, columns[0]!);
  else right = cross(columns[0]!, columns[1]!);
  if (input.handedness === "left") right = scaleVec(right, -1);
  columns[missing] = right;
  const scaled: [Vec3, Vec3, Vec3] = [
    scaleVec(columns[0] ?? [0, 0, 0], input.metersPerUnit),
    scaleVec(columns[1] ?? [0, 0, 0], input.metersPerUnit),
    scaleVec(columns[2] ?? [0, 0, 0], input.metersPerUnit),
  ];
  return [
    [scaled[0][0], scaled[1][0], scaled[2][0], 0],
    [scaled[0][1], scaled[1][1], scaled[2][1], 0],
    [scaled[0][2], scaled[1][2], scaled[2][2], 0],
    [0, 0, 0, 1],
  ];
};

/** Apply a row-major 4x4 transform to a point. The translation column is included. */
export const applyImportTransform = (matrix: Mat4, point: Vec3): Vec3 => {
  const [x, y, z] = point;
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3],
  ];
};

/**
 * Read the source axes off a world asset and attach the canonical import transform.
 * Does not modify the asset. `coordinateSystem` and `unitScaleMeters` keep their current meaning.
 */
export const sourceAxesFromWorldAsset = (
  world: Pick<WorldAsset, "coordinateSystem" | "unitScaleMeters" | "handedness" | "frontAxis">,
): SourceAxes => {
  const coordinateSystem = world.coordinateSystem ?? "Y_UP";
  const handedness = world.handedness ?? DEFAULT_HANDEDNESS;
  const frontAxis = world.frontAxis ?? defaultFrontAxis(coordinateSystem);
  const metersPerUnit = world.unitScaleMeters ?? 1;
  return sourceAxesSchema.parse({
    upAxis: coordinateSystem === "Z_UP" ? "Z" : "Y",
    handedness,
    frontAxis,
    metersPerUnit,
    importTransform: buildImportTransform({
      upAxis: coordinateSystem === "Z_UP" ? "Z" : "Y",
      handedness,
      frontAxis,
      metersPerUnit,
    }),
  });
};
