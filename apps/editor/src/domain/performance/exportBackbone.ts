import { z } from "zod";
import { backbonePoseSchema, type BackbonePose } from "../rendering/backboneV01";
import type { Project } from "../project/types";
import type { TimelineClip } from "../timeline/types";
import { clipDurationFrames, clipStartFrame } from "../timeline/timing";
import type { SmplxTrack } from "./poseTrack";
import { sampleSmplxTrack } from "./poseTrack";

export interface ExportOptions {
  fps?: number;
  /** Optional frame range override; defaults to the full clip. */
  range?: { startFrame: number; endFrameExclusive: number };
  gender?: "neutral" | "male" | "female";
  /** Betas length 10. Defaults to zeros. */
  betas?: number[];
}

/** Read authored pose tracks for a clip — ActorPoseNode parameters. */
const readSmplxTracksForClip = (project: Project, clip: TimelineClip): Array<{ id: string; track: SmplxTrack }> => {
  const graph = project.clipGraphs[clip.clipGraphId];
  if (!graph) return [];
  const nodes = graph.nodeIds.map((id) => project.nodes[id]).filter(Boolean);
  return nodes
    .filter((node) => node?.kind === "ActorPoseNode")
    .flatMap((node) => {
      const record = node?.parameters ?? {};
      const id = typeof record.actorElementId === "string" ? record.actorElementId : undefined;
      const trackMaybe = {
        actorElementId: id ?? "",
        interpolation: (record.interpolation === "hold" ? "hold" : "slerp") as SmplxTrack["interpolation"],
        keyframes: Array.isArray(record.keyframes) ? record.keyframes : [],
      };
      const parsed = z
        .object({
          actorElementId: z.string().min(1),
          interpolation: z.enum(["slerp", "hold"]),
          keyframes: z
            .array(
              z.object({
                frame: z.number().int().nonnegative(),
                pose: z.object({
                  global_orient: z.array(z.number()).length(3),
                  transl: z.array(z.number()).length(3),
                  body_pose: z.array(z.number()).length(63),
                  left_hand_pose: z.array(z.number()).length(45),
                  right_hand_pose: z.array(z.number()).length(45),
                  jaw_pose: z.array(z.number()).length(3),
                  expression: z.array(z.number()).length(10),
                }),
              }),
            )
            .default([]),
        })
        .safeParse(trackMaybe);
      return parsed.success ? [{ id: parsed.data.actorElementId, track: parsed.data as SmplxTrack }] : [];
    });
};

/** Export Backbone v0.1 per-frame SMPL-X for all authored ActorPoseNode tracks in the clip. */
export const exportBackboneSmplxForClip = (project: Project, clipId: string, options: ExportOptions = {}): BackbonePose => {
  const clip = project.clips[clipId];
  if (!clip) {
    throw new Error("Clip not found");
  }
  const fps = Math.max(1, Math.round(options.fps ?? 24));
  const start = options.range?.startFrame ?? clipStartFrame(clip);
  const end = options.range?.endFrameExclusive ?? clipStartFrame(clip) + clipDurationFrames(clip);
  const frameCount = Math.max(1, end - start);
  const defaultBetas = (options.betas && options.betas.length === 10 ? options.betas : Array(10).fill(0)) as [number, number, number, number, number, number, number, number, number, number];
  const gender = options.gender ?? "neutral";
  const tracks = readSmplxTracksForClip(project, clip);
  const humans = tracks.map(({ id, track }) => {
    const frames = Array.from({ length: frameCount }).map((_, i) => {
      const t = start + i; // clip-local frame
      const pose = sampleSmplxTrack(track, t - start) ?? track.keyframes[0]?.pose; // localize to track start at 0
      if (!pose) {
        throw new Error(`Missing SMPL-X pose for ${id} at frame ${t}`);
      }
      return {
        t: i,
        global_orient: pose.global_orient,
        transl: pose.transl,
        body_pose: pose.body_pose,
        left_hand_pose: pose.left_hand_pose,
        right_hand_pose: pose.right_hand_pose,
        jaw_pose: pose.jaw_pose,
        expression: pose.expression,
      };
    });
    return {
      id,
      model: "smplx" as const,
      gender,
      betas: defaultBetas,
      frames,
    };
  });
  const backbone = {
    version: "0.1" as const,
    fps,
    num_frames: frameCount,
    humans,
    objects: [],
  };
  return backbonePoseSchema.parse(backbone);
};

