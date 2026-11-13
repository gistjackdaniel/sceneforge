import { z } from "zod";
import type { Shot } from "../shot/types";
import { CameraTakeSource, type CameraFrame, type CameraTrajectory } from "./cameraTakeSource";
import { traceFramesGpu } from "./gpuPass";
import { deriveInstanceTable, instanceTableError } from "./instanceTable";
import type { AssetRevisionKey, FrameRange, HashContext } from "./passHash";
import { renderPassHashes } from "./passHash";
import { traceFrame } from "./referenceTrace";
import type { FramePasses, InstanceIdEntry, RenderPassKind, RenderPassSpec } from "./types";
import { RENDERER_VERSION, renderPassSpecSchema } from "./types";

const frameRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).refine((range) => range.end >= range.start, { message: "Frame range is reversed." });

const assetRevisionSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
});

export type RenderRequest = HashContext & {
  /** Integer frames to rasterize. Defaults to every frame in `frameRange`. */
  traceFrames?: readonly number[];
  backend?: "reference" | "gpu";
};

export type RenderPassOutput = {
  rendererVersion: string;
  fps: number;
  cameraId: string;
  frameRange: readonly [number, number];
  assetRevision: AssetRevisionKey;
  seed: number;
  table: readonly InstanceIdEntry[];
  hashes: Record<RenderPassKind, string>;
  trajectory: CameraFrame[];
  frames: Array<FramePasses & { camera: CameraFrame }>;
};

export type RenderResult =
  | { ok: true; output: RenderPassOutput }
  | { ok: false; reason: string };

const integersInRange = (range: FrameRange, durationFrames: number): string | undefined => {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return "Frame range must be integers.";
  if (range.start < 0 || range.end >= durationFrames || range.end < range.start) {
    return "Frame range is outside the shot.";
  }
  return undefined;
};

const resolveTable = (shot: Shot, table: readonly InstanceIdEntry[] | undefined): { ok: true; table: InstanceIdEntry[] } | { ok: false; reason: string } => {
  const resolved = table ? [...table] : deriveInstanceTable(shot);
  const reason = instanceTableError(shot, resolved);
  if (reason) return { ok: false, reason };
  return { ok: true, table: resolved };
};

const parseContext = (shot: Shot, context: HashContext): { ok: true; spec: RenderPassSpec; range: FrameRange; assetRevision: AssetRevisionKey; seed: number } | { ok: false; reason: string } => {
  const spec = renderPassSpecSchema.safeParse(context.spec);
  if (!spec.success) return { ok: false, reason: "Render spec is invalid." };
  const range = frameRangeSchema.safeParse(context.frameRange);
  if (!range.success) return { ok: false, reason: "Frame range must be integers." };
  const rangeError = integersInRange(range.data, shot.time.durationFrames);
  if (rangeError) return { ok: false, reason: rangeError };
  const assetRevision = assetRevisionSchema.safeParse(context.assetRevision);
  if (!assetRevision.success) return { ok: false, reason: "Asset revision needs assetId and revisionId." };
  if (!Number.isInteger(context.seed)) return { ok: false, reason: "Seed must be an integer." };
  return { ok: true, spec: spec.data, range: range.data, assetRevision: assetRevision.data, seed: context.seed };
};

/**
 * Protected AOV renderer.
 * Pass hashes use only `hashNormalized`. The reference backend is the
 * bit-stable path; `gpu` needs a WebGL context and is not the exit contract.
 */
export class RenderPassRenderer {
  static readonly version = RENDERER_VERSION;

  static passHashes(shot: Shot, context: HashContext): { ok: true; hashes: Record<RenderPassKind, string>; table: readonly InstanceIdEntry[] } | { ok: false; reason: string } {
    const parsed = parseContext(shot, context);
    if (!parsed.ok) return parsed;
    const table = resolveTable(shot, context.instanceTable);
    if (!table.ok) return table;
    const hashes = renderPassHashes(shot, { ...context, spec: parsed.spec, frameRange: parsed.range, assetRevision: parsed.assetRevision, seed: parsed.seed }, table.table);
    return { ok: true, hashes, table: table.table };
  }

  static render(shot: Shot, request: RenderRequest): RenderResult {
    const parsed = parseContext(shot, request);
    if (!parsed.ok) return parsed;
    const table = resolveTable(shot, request.instanceTable);
    if (!table.ok) return table;
    const traceFrames = request.traceFrames ? [...request.traceFrames] : Array.from({ length: parsed.range.end - parsed.range.start + 1 }, (_, index) => parsed.range.start + index);
    if (traceFrames.length === 0 || traceFrames.some((frame) => !Number.isInteger(frame) || frame < parsed.range.start || frame > parsed.range.end)) {
      return { ok: false, reason: "Trace frames must be integers inside the frame range." };
    }
    const pathFrames = Array.from({ length: parsed.range.end - parsed.range.start + 1 }, (_, index) => parsed.range.start + index);
    const trajectory: CameraTrajectory | { ok: false; reason: string } = CameraTakeSource.trajectory(shot, parsed.spec, pathFrames);
    if (!trajectory.ok) return trajectory;
    const traced = CameraTakeSource.trajectory(shot, parsed.spec, traceFrames);
    if (!traced.ok) return traced;
    const context: HashContext = {
      spec: parsed.spec,
      frameRange: parsed.range,
      assetRevision: parsed.assetRevision,
      seed: parsed.seed,
    };
    const hashes = renderPassHashes(shot, context, table.table);
    const backend = request.backend ?? "reference";
    if (backend === "gpu") {
      const gpu = traceFramesGpu(shot, traced.frames, parsed.spec, table.table);
      if (!gpu.ok) return gpu;
      return {
        ok: true,
        output: pack(trajectory, gpu.frames, traced.frames, hashes, table.table, parsed),
      };
    }
    const frames = traced.frames.map((camera) => traceFrame(shot, camera, parsed.spec, table.table));
    return { ok: true, output: pack(trajectory, frames, traced.frames, hashes, table.table, parsed) };
  }
}

const pack = (
  trajectory: CameraTrajectory,
  frames: FramePasses[],
  cameras: readonly CameraFrame[],
  hashes: Record<RenderPassKind, string>,
  table: readonly InstanceIdEntry[],
  parsed: { range: FrameRange; assetRevision: AssetRevisionKey; seed: number },
): RenderPassOutput => ({
  rendererVersion: RENDERER_VERSION,
  fps: trajectory.fps,
  cameraId: trajectory.cameraId,
  frameRange: [parsed.range.start, parsed.range.end],
  assetRevision: parsed.assetRevision,
  seed: parsed.seed,
  table,
  hashes,
  trajectory: trajectory.frames,
  frames: frames.map((frame, index) => {
    const camera = cameras[index];
    if (!camera) throw new Error("Missing camera frame.");
    return { ...frame, camera };
  }),
});
