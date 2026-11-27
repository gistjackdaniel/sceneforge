import { z } from "zod";
import { vec3Schema } from "../../domain/sceneAuthoring/contract";
import { somaFrameSchema, type SomaFrame } from "../../domain/sceneAuthoring/somaMotion";
import { motionSourceSchema, type MotionSource } from "../../domain/shot/motionConditions";
import { loadKimodoMotion } from "./kimodoMotion";

/** New ARDY frames that replace everything from `start` on. */
const chunkSchema = z.object({ start: z.number().int().min(0), frames: z.array(somaFrameSchema).min(1) });
const skeletonSchema = z.object({
  joints: z.array(z.string()).length(77),
  jointParents: z.array(z.int()).length(77),
  jointOffsets: z.array(vec3Schema).length(77),
});
export type ArdyChunk = { start: number; frames: SomaFrame[] };
export type ArdySkeleton = z.infer<typeof skeletonSchema>;

const post = async (path: string, body: unknown, signal?: AbortSignal) => {
  const response = await fetch(path, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const reply = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof reply.error === "string" ? reply.error : "ARDY 실시간 조종을 진행하지 못했습니다.");
  return reply;
};

/** Load ARDY if needed and generate the first two seconds. The first start loads a 15 GB text encoder. */
export const startArdy = async (prompt: string, signal: AbortSignal): Promise<{ skeleton: ArdySkeleton; chunk: ArdyChunk }> => {
  const reply = await post("/api/ardy/start", { prompt }, signal);
  return { skeleton: skeletonSchema.parse(reply), chunk: chunkSchema.parse(reply) };
};

/** Replan from just past `frame`, steering the root toward `velocity` (metres per second in the motion's frame). */
export const stepArdy = async (frame: number, velocity: [number, number], prompt: string, signal?: AbortSignal): Promise<ArdyChunk> =>
  chunkSchema.parse(await post("/api/ardy/step", { frame, velocity, prompt }, signal));

/** Keep frames [from, to) as a clip, checked like a Kimodo clip before the shot uses it. */
export const saveArdyClip = async (from: number, to: number, signal?: AbortSignal): Promise<MotionSource> => {
  const source = motionSourceSchema.parse(await post("/api/ardy/clip", { from, to }, signal));
  await loadKimodoMotion(source, signal);
  return source;
};

/** Let ARDY exit and free the GPU. */
export const stopArdy = () => fetch("/api/ardy/stop", { method: "POST", keepalive: true }).catch(() => undefined);
