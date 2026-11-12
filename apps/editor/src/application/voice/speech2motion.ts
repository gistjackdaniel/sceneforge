import type { DomainCommand } from "../commands/types";
import { executeCommand, type CommandBusState, type ExecuteResult } from "../commands/bus";
import type { Shot } from "../../domain/shot";
import type { ActionGraph } from "../../domain/speech2motion/actionGraph";
import { produceSpeech2Motion, type Speech2MotionInput } from "../../domain/speech2motion/produce";
import type { Sequence } from "../../domain/timeline/types";
import { shotFps, toFrame, type ShotTiming } from "./toFrame";

const usableFps = (fps: number | undefined): number | undefined =>
  typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : undefined;

/**
 * Shot.fps, then Sequence.fps, then {@link shotFps} which falls back to `DEFAULT_CLIP_FPS`.
 * A missing shot must not skip a usable sequence rate.
 */
export const speech2MotionFps = (
  shot: Pick<Shot, "time"> | ShotTiming | undefined,
  sequence: Pick<Sequence, "fps"> | undefined,
): number => {
  const shotFpsValue = shot && "time" in shot ? shot.time?.fps : shot?.fps;
  const resolved = usableFps(shotFpsValue);
  if (resolved !== undefined) return resolved;
  return shotFps(sequence);
};

export const speech2MotionClock = (
  shot: Pick<Shot, "time"> | ShotTiming | undefined,
  sequence: Pick<Sequence, "fps"> | undefined,
): Speech2MotionInput["clock"] => ({
  fps: speech2MotionFps(shot, sequence),
  toFrame,
});

export type UtteranceRequest = Omit<Speech2MotionInput, "clock" | "durationFrames"> & {
  shot?: Pick<Shot, "time"> | ShotTiming;
  sequence?: Pick<Sequence, "fps">;
};

/**
 * Run the text ASR stub and the pure producer.
 * Returns commands and does not apply them. Callers pass those commands to the domain command bus.
 */
export const planSpeech2Motion = (
  request: UtteranceRequest,
): { graph: ActionGraph; commands: DomainCommand[] } => {
  const durationFrames = request.shot && "time" in request.shot ? request.shot.time?.durationFrames : undefined;
  const graph = produceSpeech2Motion({
    ...request,
    clock: speech2MotionClock(request.shot, request.sequence),
    ...(typeof durationFrames === "number" ? { durationFrames } : {}),
  });
  return { graph, commands: commandsForSpeech2Motion(graph) };
};

/** A clarification is not a state change. A ready graph is one `RECORD_SPEECH2MOTION` command. */
export const commandsForSpeech2Motion = (graph: ActionGraph): DomainCommand[] => {
  if (graph.status !== "ready") return [];
  return [{ type: "RECORD_SPEECH2MOTION", shotId: graph.shot_id, graph }];
};

/** Apply the producer's commands through the domain command bus. */
export const commitSpeech2Motion = (
  project: Parameters<typeof executeCommand>[0],
  bus: CommandBusState,
  graph: ActionGraph,
  timestamp: string,
): ExecuteResult => {
  const [command] = commandsForSpeech2Motion(graph);
  if (!command) {
    return {
      project,
      bus,
      result: {
        ok: false,
        command: { type: "RECORD_SPEECH2MOTION", shotId: graph.shot_id, graph: null },
        events: [],
        reason: "A clarification is not recorded.",
      },
    };
  }
  return executeCommand(project, bus, command, timestamp);
};
