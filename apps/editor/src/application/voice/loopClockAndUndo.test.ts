import { describe, it, expect } from "vitest";
import { createLoopClock } from "../ports/LoopClock";
import { ruleBasedParser } from "../../infrastructure/voice/IntentParser/ruleBasedParser";
import type { Project } from "../../domain/project/types";
import { applyCommand } from "../commands/apply";
import { executeCommand, undoCommand, emptyCommandBusState } from "../commands/bus";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";

const createProject = (): Project => {
  const now = new Date().toISOString();
  return {
    id: "p1",
    name: "test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq",
    sequences: { seq: { id: "seq", name: "S", clipIds: ["c1"], playhead: 0, visibleRange: [0, 100], fps: 24 } },
    clips: {
      c1: {
        id: "c1",
        name: "C1",
        start: 0,
        end: 100,
        duration: 100,
        startFrame: 0,
        durationFrames: 100,
        sourceInFrame: 0,
        playbackRate: 1,
        sourceType: "empty",
        linkedWorldId: "w1",
        clipGraphId: "g1",
        cameraPathNodeId: "node-c1-trajectory",
        performancePlanNodeId: "node-c1-perf",
        cameraTrajectoryNodeId: "node-c1-trajectory",
        graphSnapshotId: "g1",
        cacheStatus: "invalid",
        variant: "main",
        activeVariantId: "main",
        variants: [{ id: "main", name: "Main", overridePatch: {} }],
      },
    },
    clipGraphs: { g1: { id: "g1", clipId: "c1", rootNodeId: "root", nodeIds: ["node-c1-trajectory"], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes: {
      "node-c1-trajectory": {
        id: "node-c1-trajectory",
        name: "Camera Path",
        kind: "CameraPathNode",
        type: "CameraPathNode",
        category: "cinematic",
        scope: "clip",
        enabled: true,
        tags: [],
        version: 1,
        referenceType: "local",
        parameters: { keyframes: [], interpolation: "linear", frameCount: 120 },
        params: { keyframes: [], interpolation: "linear", frameCount: 120 },
        downstreamNodeIds: ["node-c1-render"],
        inputPorts: [{ id: "in", label: "in", kind: "data" }],
        outputPorts: [{ id: "out", label: "out", kind: "data" }],
        createdAt: now,
        updatedAt: now,
        status: "clean",
      } as any,
    },
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: {
      w1: {
        id: "w1",
        name: "Room",
        representation: "mesh",
        proxyKind: "usd",
        sourceAssetIds: [],
        rootUri: "/",
        coordinateSystem: "Y_UP",
        unitScaleMeters: 1,
        elements: [{ id: "e-chair-1", name: "Chair", kind: "socket", description: "" }],
        version: 1,
        createdAt: now,
        updatedAt: now,
        usdPath: "",
        semanticsPath: "",
        navmeshPath: "",
        previewPath: "",
        semanticTags: [],
        props: [],
      } as any,
    },
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};

describe("loop clock + undo for voice-mapped commands", () => {
  it("does not pause the loop while applying a camera look-at", () => {
    const project = createProject();
    const parser = ruleBasedParser();
    const clock = createLoopClock({ duration: 10, fps: 24, autoplay: false });
    const ticks: number[] = [];
    clock.subscribe((t) => ticks.push(t));
    clock.start();
    const intent = parser.parse({ text: "look at chair", locale: "en" })!;
    // Simulate mapping and apply via command bus
    const tSeconds = clock.getTime();
    const frame = Math.round(tSeconds * 24);
    const nodeId = "node-c1-trajectory";
    const current = cameraPathParamsFromNode(project.nodes[nodeId].parameters);
    const patch = { ...current, lookAtTargetElementId: "e-chair-1", trackingStrength: 0.7 };
    const res = applyCommand(project, { type: "UPDATE_NODE_PARAMS", nodeId, patch }, { timestamp: new Date().toISOString() });
    expect(res.result.ok).toBe(true);
    // Loop still playing (non-blocking apply)
    expect(clock.isPlaying).toBe(true);
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it("produces undoable command sequence", () => {
    let project = createProject();
    const bus = emptyCommandBusState();
    const nodeId = "node-c1-trajectory";
    const current = cameraPathParamsFromNode(project.nodes[nodeId].parameters);
    const patch = { ...current, lookAtTargetElementId: "e-chair-1", trackingStrength: 0.7 };
    const executed = executeCommand(project, bus, { type: "UPDATE_NODE_PARAMS", nodeId, patch }, new Date().toISOString());
    expect(executed.result.ok).toBe(true);
    const undone = undoCommand(executed.project, executed.bus, new Date().toISOString());
    expect(undone.result.ok).toBe(true);
  });
});

