import type { Project } from "../../domain/project/types";
import { applyCommand } from "./apply";
import type { CommandResult, DomainCommand, DomainEvent } from "./types";

export interface CommandBusState {
  undoStack: DomainCommand[];
  redoStack: DomainCommand[];
  events: DomainEvent[];
}

export const emptyCommandBusState = (): CommandBusState => ({
  undoStack: [],
  redoStack: [],
  events: [],
});

const textPoseSubject = (command: DomainCommand): { shotId: string; subjectId: string } | undefined => {
  if (command.type !== "SHOT") return undefined;
  const shotCommand = command.command;
  if (shotCommand.type === "SET_TEXT_POSE") return { shotId: shotCommand.shotId, subjectId: shotCommand.subjectId };
  if (shotCommand.type === "REPLACE_SUBJECT") return { shotId: shotCommand.shotId, subjectId: shotCommand.subject.id };
  return undefined;
};

/**
 * A burst of text-pose edits is one undo step.
 * A pose key stores a different inverse, so the next sentence starts a new step.
 */
export const shouldCoalesceTextPose = (
  command: DomainCommand,
  topInverse: DomainCommand | undefined,
  currentMotion: "unset" | "text" | "explicit" | undefined,
): boolean => {
  if (command.type !== "SHOT" || command.command.type !== "SET_TEXT_POSE" || !topInverse) return false;
  const incoming = textPoseSubject(command);
  const previous = textPoseSubject(topInverse);
  if (!incoming || !previous || incoming.shotId !== previous.shotId || incoming.subjectId !== previous.subjectId) return false;
  if (topInverse.type === "SHOT" && topInverse.command.type === "SET_TEXT_POSE") return true;
  return topInverse.type === "SHOT"
    && topInverse.command.type === "REPLACE_SUBJECT"
    && topInverse.command.subject.kind !== "light"
    && topInverse.command.subject.motion.channel === "explicit"
    && currentMotion === "text";
};

const motionChannel = (project: Project, command: DomainCommand): "unset" | "text" | "explicit" | undefined => {
  if (command.type !== "SHOT") return undefined;
  const shotCommand = command.command;
  if (shotCommand.type !== "SET_TEXT_POSE") return undefined;
  const subject = project.shots?.[shotCommand.shotId]?.subjects.find((item) => item.id === shotCommand.subjectId);
  return subject && subject.kind !== "light" ? subject.motion.channel : undefined;
};

export interface ExecuteResult {
  project: Project;
  bus: CommandBusState;
  result: CommandResult;
}

/**
 * Command-unit undo/redo (PRD §13). Inverse commands are pushed on success.
 */
export const executeCommand = (
  project: Project,
  bus: CommandBusState,
  command: DomainCommand,
  timestamp: string,
): ExecuteResult => {
  const { project: nextProject, result } = applyCommand(project, command, { timestamp });
  if (!result.ok) {
    return { project, bus, result };
  }
  const coalesce = shouldCoalesceTextPose(command, bus.undoStack[bus.undoStack.length - 1], motionChannel(project, command));
  const undoStack = !result.inverse || coalesce ? bus.undoStack : [...bus.undoStack, result.inverse];
  return {
    project: nextProject,
    bus: {
      undoStack,
      redoStack: [],
      events: [...bus.events, ...result.events],
    },
    result,
  };
};

export const undoCommand = (
  project: Project,
  bus: CommandBusState,
  timestamp: string,
): ExecuteResult => {
  if (bus.undoStack.length === 0) {
    return {
      project,
      bus,
      result: { ok: false, command: { type: "INVALIDATE_CACHE", nodeId: "" }, events: [], reason: "Nothing to undo." },
    };
  }
  const inverse = bus.undoStack[bus.undoStack.length - 1];
  const { project: nextProject, result } = applyCommand(project, inverse, { timestamp });
  if (!result.ok) {
    return { project, bus, result };
  }
  return {
    project: nextProject,
    bus: {
      undoStack: bus.undoStack.slice(0, -1),
      redoStack: result.inverse ? [...bus.redoStack, result.inverse] : bus.redoStack,
      events: [...bus.events, ...result.events],
    },
    result,
  };
};

export const redoCommand = (
  project: Project,
  bus: CommandBusState,
  timestamp: string,
): ExecuteResult => {
  if (bus.redoStack.length === 0) {
    return {
      project,
      bus,
      result: { ok: false, command: { type: "INVALIDATE_CACHE", nodeId: "" }, events: [], reason: "Nothing to redo." },
    };
  }
  const command = bus.redoStack[bus.redoStack.length - 1];
  const { project: nextProject, result } = applyCommand(project, command, { timestamp });
  if (!result.ok) {
    return { project, bus, result };
  }
  return {
    project: nextProject,
    bus: {
      undoStack: result.inverse ? [...bus.undoStack, result.inverse] : bus.undoStack,
      redoStack: bus.redoStack.slice(0, -1),
      events: [...bus.events, ...result.events],
    },
    result,
  };
};
