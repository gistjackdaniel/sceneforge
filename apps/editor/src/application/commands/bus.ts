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
  const undoStack = result.inverse ? [...bus.undoStack, result.inverse] : bus.undoStack;
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
