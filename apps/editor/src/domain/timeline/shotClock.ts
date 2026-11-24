import type { Project } from "../project/types";
import { shotFps } from "../shot/queries";
import { DEFAULT_CLIP_FPS } from "./timing";

/**
 * Frame rate for one clip.
 * A stored shot's `time.fps` is the clock. Sequence fps is used only when that shot is absent.
 */
export const shotFpsForClip = (
  project: Pick<Project, "shots" | "sequences" | "activeSequenceId">,
  clipId: string,
): number => {
  const shot = project.shots?.[clipId];
  if (shot) return shotFps(shot);
  const sequence = Object.values(project.sequences).find((item) => item.clipIds.includes(clipId))
    ?? project.sequences[project.activeSequenceId];
  const fps = sequence?.fps;
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) return fps;
  return DEFAULT_CLIP_FPS;
};
