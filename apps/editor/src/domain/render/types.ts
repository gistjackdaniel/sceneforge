import { z } from "zod";

/** Protected AOV kinds. One cache key per kind. */
export const RENDER_PASS_KINDS = ["rgb", "depth", "normal", "world_position", "instance_id"] as const;

export type RenderPassKind = (typeof RENDER_PASS_KINDS)[number];

/**
 * Pixel formats for the protected path.
 * Depth is linear camera-space z in meters (OpenGL camera, so stored z is the
 * positive distance in front of the camera: `-viewZ`). Normals are world-space
 * unit vectors. World position is world-space meters. Instance id is the
 * uint32 index from `InstanceIdTable` (0 = miss).
 */
export const RENDER_PASS_FORMAT = {
  rgb: { encoding: "uint8", channels: 3, colorSpace: "srgb", order: "rgb" },
  depth: { encoding: "float32", channels: 1, space: "camera", axis: "linear_z", units: "meters" },
  normal: { encoding: "float32", channels: 3, space: "world", normalized: true },
  world_position: { encoding: "float32", channels: 3, space: "world", units: "meters" },
  instance_id: { encoding: "uint32", channels: 1, miss: 0 },
} as const;

export type RenderPassFormat = (typeof RENDER_PASS_FORMAT)[RenderPassKind];

export const renderPassSpecSchema = z
  .object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    near: z.number().positive(),
    far: z.number().positive(),
  })
  .refine((spec) => spec.far > spec.near, { message: "far must be greater than near" });

export type RenderPassSpec = z.infer<typeof renderPassSpecSchema>;

export const defaultRenderPassSpec = (width: number, height: number): RenderPassSpec =>
  renderPassSpecSchema.parse({ width, height, near: 0.05, far: 100 });

/** 0 is miss and is not an entry. Indices are stable for a given id set. */
export type InstanceIdEntry = {
  index: number;
  persistentId: string;
  role: "actor" | "object" | "room";
};

export type RgbPass = {
  kind: "rgb";
  width: number;
  height: number;
  format: (typeof RENDER_PASS_FORMAT)["rgb"];
  data: Uint8Array;
};

export type DepthPass = {
  kind: "depth";
  width: number;
  height: number;
  format: (typeof RENDER_PASS_FORMAT)["depth"];
  data: Float32Array;
};

export type NormalPass = {
  kind: "normal";
  width: number;
  height: number;
  format: (typeof RENDER_PASS_FORMAT)["normal"];
  data: Float32Array;
};

export type WorldPositionPass = {
  kind: "world_position";
  width: number;
  height: number;
  format: (typeof RENDER_PASS_FORMAT)["world_position"];
  data: Float32Array;
};

export type InstanceIdPass = {
  kind: "instance_id";
  width: number;
  height: number;
  format: (typeof RENDER_PASS_FORMAT)["instance_id"];
  data: Uint32Array;
  table: readonly InstanceIdEntry[];
};

export type RenderPassBuffer = RgbPass | DepthPass | NormalPass | WorldPositionPass | InstanceIdPass;

export type FramePasses = {
  frame: number;
  rgb: RgbPass;
  depth: DepthPass;
  normal: NormalPass;
  world_position: WorldPositionPass;
  instance_id: InstanceIdPass;
};

/** Bumped when proxy geometry, shading, or ray convention changes the pixels. */
export const RENDERER_VERSION = "aov-reference-1";
