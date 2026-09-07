import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import type { Project } from "../../domain/project/types";
import { applyCameraRigToProject, validateLookAtElement } from "./cameraCraft";
import { lensParamsFromNode } from "../../domain/graph/lens";
import { isCameraMotionKind, isObjectMotionKind } from "../../domain/graph/motion";

const now = "2026-08-27T00:00:00.000Z";
const ports = defaultPorts();

const pathNode = (): NodeBase => ({
  id: "node-clip-a-trajectory",
  name: "Camera Path",
  kind: "CameraPathNode",
  type: "CameraPathNode",
  category: "cinematic",
  scope: "clip",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "local",
  parameters: { keyframes: [], interpolation: "linear" },
  params: { keyframes: [], interpolation: "linear" },
  downstreamNodeIds: ["node-clip-a-render"],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: now,
  updatedAt: now,
});

const renderNode = (): NodeBase => ({
  ...pathNode(),
  id: "node-clip-a-render",
  name: "Render",
  kind: "RenderSettingsNode",
  type: "RenderSettingsNode",
  downstreamNodeIds: [],
  parameters: {},
  params: {},
});

const projectFixture = (): Project => ({
  id: "p1",
  name: "Test",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: {
    "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a", "clip-b"], playhead: 0, visibleRange: [0, 200] },
  },
  clips: {
    "clip-a": {
      id: "clip-a",
      name: "A",
      start: 0,
      end: 48,
      duration: 48,
      startFrame: 0,
      durationFrames: 48,
      sourceType: "empty",
      clipGraphId: "g-a",
      cameraPathNodeId: "node-clip-a-trajectory",
      cacheStatus: "valid",
    },
    "clip-b": {
      id: "clip-b",
      name: "B",
      start: 48,
      end: 96,
      duration: 48,
      startFrame: 48,
      durationFrames: 48,
      sourceType: "empty",
      clipGraphId: "g-b",
      cacheStatus: "valid",
    },
  },
  clipGraphs: {
    "g-a": {
      id: "g-a",
      clipId: "clip-a",
      rootNodeId: "node-clip-a-render",
      nodeIds: ["node-clip-a-trajectory", "node-clip-a-render"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
    "g-b": {
      id: "g-b",
      clipId: "clip-b",
      rootNodeId: "orphan",
      nodeIds: ["orphan"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: [],
    },
  },
  nodes: {
    "node-clip-a-trajectory": pathNode(),
    "node-clip-a-render": renderNode(),
    orphan: { ...renderNode(), id: "orphan", name: "Orphan" },
  },
  references: {},
  dependencyMap: {
    downstreamByNodeId: {
      "node-clip-a-trajectory": ["node-clip-a-render"],
      "node-clip-a-render": [],
      orphan: [],
    },
    clipsByNodeId: {
      "node-clip-a-trajectory": ["clip-a"],
      "node-clip-a-render": ["clip-a"],
      orphan: ["clip-b"],
    },
    referencesByNodeId: {},
    cacheHashesByClipId: { "clip-a": "ha", "clip-b": "hb" },
  },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

describe("camera craft", () => {
  it("applies presets onto CameraRigNode and CameraPathNode, never a model-named node", () => {
    const applied = applyCameraRigToProject(projectFixture(), {
      clipId: "clip-a",
      preset: "dolly_in",
      durationFrames: 48,
      startPosition: [2.5, 1.8, 3.2],
      startRotation: [0, 0, 0],
      timestamp: now,
    });
    expect("reason" in applied).toBe(false);
    if ("reason" in applied) {
      return;
    }
    const rig = applied.project.nodes[applied.rigNodeId];
    expect(rig.kind).toBe("CameraRigNode");
    expect(rig.parameters.preset).toBe("dolly_in");
    expect(isCameraMotionKind(rig.kind)).toBe(true);
    expect(applied.project.nodes[applied.pathNodeId].kind).toBe("CameraPathNode");
    const keyframes = applied.project.nodes[applied.pathNodeId].parameters.keyframes as unknown[];
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    expect(applied.project.nodes.orphan.status).toBe("clean");
    expect(rig.type).toBe("CameraRigNode");
  });

  it("keeps lens params off placement/camera transform nodes", () => {
    const lens = lensParamsFromNode({ focalLengthMm: 50, aperture: 2.8 });
    expect(lens.focalLengthMm).toBe(50);
    expect(isObjectMotionKind("PlacementNode")).toBe(false);
    expect(isCameraMotionKind("LensNode")).toBe(true);
  });

  it("rejects a look-at target that is not a world element ID", () => {
    expect(validateLookAtElement("missing-element", [{ id: "hero" }])).toEqual({
      ok: false,
      reason: "Look-at target was deleted or is not a world element ID.",
    });
    expect(validateLookAtElement("hero", [{ id: "hero" }])).toEqual({ ok: true });
    expect(validateLookAtElement(undefined, [{ id: "hero" }])).toEqual({ ok: true });
  });
});
