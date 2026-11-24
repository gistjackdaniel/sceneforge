import type { DomainCommand } from "../commands/types";
import { executeCommand, type CommandBusState, type ExecuteResult } from "../commands/bus";
import { readShotTimeFps, type Shot, type ShotCommand } from "../../domain/shot";
import type { ActionGraph } from "../../domain/speech2motion/actionGraph";
import { produceSpeech2Motion, type Speech2MotionInput } from "../../domain/speech2motion/produce";
import { Speech2MotionPipeline } from "../../domain/speech2motion/pipeline";
import { createWorldTargetResolver } from "../../domain/worlds/query";
import type { Project } from "../../domain/project/types";
import { toFrame } from "./toFrame";

/** Shot clock. Frame rate lives only on `Shot.time`. */
export type ShotClockSource = Pick<Shot, "time">;

/**
 * Frame rate for a speech2motion graph.
 * `readShotTimeFps` fails when `Shot.time.fps` is missing. Timeline's `shotFps` fallback is not used.
 */
export const speech2MotionFps = (shot: ShotClockSource): number => readShotTimeFps(shot);

/**
 * Clock whose seconds convert with `toFrame(t, shot.time.fps)`.
 * A rate passed into `toFrame` cannot replace the shot rate. Frames stay integers.
 */
export const speech2MotionClock = (shot: ShotClockSource): Speech2MotionInput["clock"] => {
  const fps = readShotTimeFps(shot);
  return {
    fps,
    toFrame: (tSeconds: number, _rate: number) => toFrame(tSeconds, readShotTimeFps(shot)),
  };
};

export type UtteranceRequest = Omit<Speech2MotionInput, "clock" | "durationFrames"> & {
  shot: ShotClockSource;
};

/**
 * Run the text ASR stub and the pure producer.
 * Returns commands and does not apply them. Callers pass those commands to the domain command bus.
 */
export const planSpeech2Motion = (
  request: UtteranceRequest,
): { graph: ActionGraph; commands: DomainCommand[] } => {
  const durationFrames = request.shot.time.durationFrames;
  const graph = produceSpeech2Motion({
    ...request,
    clock: speech2MotionClock(request.shot),
    ...(typeof durationFrames === "number" ? { durationFrames } : {}),
  });
  return { graph, commands: commandsForSpeech2Motion(graph) };
};

/** A clarification is not a state change. A ready graph is one `RECORD_SPEECH2MOTION` command. */
export const commandsForSpeech2Motion = (graph: ActionGraph): DomainCommand[] => {
  if (graph.status !== "ready") return [];
  return [{ type: "RECORD_SPEECH2MOTION", shotId: graph.shot_id, graph }];
};

/**
 * Turn a ready graph into shot commands.
 * `RECORD_SPEECH2MOTION` stores the graph only. These commands write the body and face onto subjects.
 */
export const poseCommandsForGraph = (project: Project, shot: Shot, graph: ActionGraph): readonly ShotCommand[] => {
  if (graph.status !== "ready" || graph.shot_id !== shot.id) return [];
  const solved = Speech2MotionPipeline.run({
    graph,
    shot,
    targetResolver: createWorldTargetResolver(project.worlds, project.sceneStates),
  });
  return solved.ok ? solved.commands : [];
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
