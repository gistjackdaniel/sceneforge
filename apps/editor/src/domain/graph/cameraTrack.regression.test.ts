import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { eulerToQuaternionApprox } from "../../application/services/viewportCommit";
import { commitCameraTake, defaultCameraPathParams, deleteCameraTake } from "./cameraPath";
import { buildBackboneCameraForClip } from "../../application/services/backboneExport";
import type { Project } from "../project/types";
import { defaultPorts, type NodeBase } from "./types";

const now = "2026-01-01T00:00:00.000Z";

const keyframe = (frame: number, x: number) => ({
  frame,
  position: [x, 1.6, 3] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  focalLengthMm: 35,
});

describe("camera track regressions reported against main @ ea86afa", () => {
  it("stores the viewport XYZ orientation, matching Three.js rather than a ZYX encoding", () => {
    const euler: [number, number, number] = [-0.3, 0.8, 0.1];
    const viewport = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], "XYZ"));
    const stored = eulerToQuaternionApprox(euler);
    const storedQuat = new THREE.Quaternion(stored[0], stored[1], stored[2], stored[3]);
    expect(viewport.angleTo(storedQuat)).toBeLessThan(1e-6);
  });

  it("does not reuse a take id after another take is deleted", () => {
    const first = commitCameraTake(defaultCameraPathParams(), {
      source: "record",
      keyframes: [keyframe(0, 0), keyframe(1, 1)],
      createdAt: now,
    });
    const second = commitCameraTake(first, {
      source: "record",
      keyframes: [keyframe(0, 9), keyframe(1, 8)],
      createdAt: now,
    });
    const removedId = first.takes[0]?.id;
    expect(removedId).toBeTruthy();
    const deleted = deleteCameraTake(second, removedId!);
    const third = commitCameraTake(deleted, {
      source: "record",
      keyframes: [keyframe(0, 3), keyframe(1, 4)],
      createdAt: now,
    });
    const ids = third.takes.map((take) => take.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(removedId);
    expect(ids.every((id) => /^cam_[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
  });

  it("exports at the same fps recording uses, not the backbone schema default of 16", () => {
    const ports = defaultPorts();
    const node = (id: string, kind: NodeBase["kind"], parameters: Record<string, unknown>): NodeBase => ({
      id,
      name: id,
      kind,
      type: kind,
      category: "cinematic",
      scope: "clip",
      enabled: true,
      tags: [],
      version: 1,
      referenceType: "local",
      parameters,
      params: parameters,
      downstreamNodeIds: [],
      status: "clean",
      inputPorts: ports.inputPorts,
      outputPorts: ports.outputPorts,
      createdAt: now,
      updatedAt: now,
    });
    const project: Project = {
      id: "p1",
      name: "Test",
      createdAt: now,
      updatedAt: now,
      metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
      activeSequenceId: "seq-1",
      sequences: {
        "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-a"], playhead: 0, visibleRange: [0, 48] },
      },
      clips: {
        "clip-a": {
          id: "clip-a",
          name: "A",
          start: 0,
          end: 24,
          duration: 24,
          startFrame: 0,
          durationFrames: 24,
          sourceType: "empty",
          clipGraphId: "g-a",
          cameraPathNodeId: "node-clip-a-trajectory",
          cacheStatus: "valid",
        },
      },
      clipGraphs: {
        "g-a": {
          id: "g-a",
          clipId: "clip-a",
          rootNodeId: "render",
          nodeIds: ["render", "node-clip-a-trajectory", "node-clip-a-lens"],
          edges: [],
          previewFrames: [],
          finalFrames: [],
          keyframeNodeIds: [],
        },
      },
      nodes: {
        render: node("render", "RenderSettingsNode", {}),
        "node-clip-a-trajectory": node("node-clip-a-trajectory", "CameraPathNode", {
          keyframes: [keyframe(0, 0), keyframe(24, 1)],
          interpolation: "linear",
        }),
        "node-clip-a-lens": node("node-clip-a-lens", "LensNode", { focalLengthMm: 35, sensorPreset: "full-frame" }),
      },
      references: {},
      dependencyMap: {
        downstreamByNodeId: {},
        clipsByNodeId: {},
        referencesByNodeId: {},
        cacheHashesByClipId: {},
      },
      worlds: {},
      assets: {},
      caches: {},
      connectors: {},
      libraryNodeIds: [],
    };
    const cam = buildBackboneCameraForClip(project, "clip-a", [1280, 720], { numFrames: 24 });
    expect(cam.fps).toBe(24);
  });
});
