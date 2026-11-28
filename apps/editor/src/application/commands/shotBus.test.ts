import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, shouldCoalesceTextPose } from "./bus";
import { applyShotCommand } from "../../domain/shot";
import { parseShot, shotId, subjectId, type Shot } from "../../domain/shot";
import type { Project } from "../../domain/project/types";

const now = "2026-11-04T00:00:00.000Z";

const shot = (): Shot => {
  const parsed = parseShot({
    schemaVersion: 1,
    id: "clip-001",
    name: "Shot",
    time: { fps: 24, durationFrames: 24, origin: "clip_local" },
    subjects: [],
    camera: { status: "empty", lens: { focalLengthMm: 35 }, interpolation: "linear" },
    renders: [],
  });
  const edited = applyShotCommand(parsed, {
    type: "ADD_SUBJECT",
    shotId: shotId("clip-001"),
    draft: { kind: "object", id: "box-1", name: "Crate", primitive: "box" },
  }, now);
  if (!edited.ok) throw new Error(edited.reason);
  return edited.shot;
};

const project = (current: Shot): Project => ({
  id: "p",
  name: "P",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq",
  sequences: { seq: { id: "seq", name: "Main", clipIds: [current.id], playhead: 0, visibleRange: [0, 24] } },
  clips: {
    [current.id]: { id: current.id, name: current.name, start: 0, end: 24, duration: 24, sourceType: "empty", clipGraphId: "g", cacheStatus: "valid" },
  },
  clipGraphs: { g: { id: "g", clipId: current.id, rootNodeId: "n", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
  shots: { [current.id]: current },
});

describe("text pose undo", () => {
  it("keeps one inverse for a burst and starts a new one after a pose key", () => {
    let current = project(shot());
    let bus = emptyCommandBusState();
    const text = (prompt: string, subject = "box-1") => {
      const command = { type: "SHOT" as const, command: { type: "SET_TEXT_POSE" as const, shotId: shotId("clip-001"), subjectId: subjectId(subject), prompt } };
      const executed = executeCommand(current, bus, command, now);
      current = executed.project;
      bus = executed.bus;
      return executed;
    };
    text("w");
    expect(bus.undoStack).toHaveLength(1);
    text("wa");
    expect(bus.undoStack).toHaveLength(1);
    const other = applyShotCommand(current.shots!["clip-001"], {
      type: "ADD_SUBJECT",
      shotId: shotId("clip-001"),
      draft: { kind: "object", id: "box-2", name: "Other", primitive: "sphere" },
    }, now);
    if (!other.ok) throw new Error(other.reason);
    current = { ...current, shots: { "clip-001": other.shot } };
    text("s", "box-2");
    expect(bus.undoStack).toHaveLength(2);
    const keyed = executeCommand(current, bus, {
      type: "SHOT",
      command: {
        type: "KEY_SUBJECT_POSE",
        shotId: shotId("clip-001"),
        subjectId: subjectId("box-1"),
        key: { frame: 1, position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
      },
    }, now);
    current = keyed.project;
    bus = keyed.bus;
    const before = bus.undoStack.length;
    text("walks");
    expect(bus.undoStack.length).toBe(before + 1);
    const top = bus.undoStack[0];
    expect(shouldCoalesceTextPose(
      { type: "SHOT", command: { type: "SET_TEXT_POSE", shotId: shotId("clip-001"), subjectId: subjectId("box-2"), prompt: "more" } },
      top,
      "text",
    )).toBe(false);
  });
});
