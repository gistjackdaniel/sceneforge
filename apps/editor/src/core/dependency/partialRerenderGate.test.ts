import { describe, it, expect } from "vitest";
import { PartialRerenderGate } from "./partialRerenderGate";
import type { DependencyMap } from "../../domain/project/clipGraph";
import type { TimelineClip } from "../project/types";

const clip = (id: string, name: string): TimelineClip =>
  ({
    id,
    name,
    trackId: "V1",
    start: 0,
    end: 120,
    duration: 120,
    startFrame: 0,
    durationFrames: 120,
    sourceInFrame: 0,
    playbackRate: 1,
    sourceType: "empty",
    linkedWorldId: undefined,
    worldMode: "referenced",
    clipGraphId: `graph-${id}`,
    cameraPathNodeId: `node-${id}-trajectory`,
    performancePlanNodeId: `node-${id}-performance`,
    cameraTrajectoryNodeId: `node-${id}-trajectory`,
    graphSnapshotId: `graph-${id}`,
    cacheStatus: "invalid",
    variant: "main",
    activeVariantId: "main",
    variants: [{ id: "main", name: "Main", overridePatch: {} }],
  }) as unknown as TimelineClip;

describe("PartialRerenderGate", () => {
  it("computes pending state with all affected clips preselected", () => {
    const clips = {
      "clip-a": clip("clip-a", "Clip A"),
      "clip-b": clip("clip-b", "Clip B"),
    };
    const depMap: DependencyMap = {
      downstreamByNodeId: { "node-x": [] },
      clipsByNodeId: { "node-x": ["clip-a", "clip-b"] },
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    };
    const pending = PartialRerenderGate.computePending("node-x", "Cool Node", clips, depMap)!;
    expect(pending).toBeTruthy();
    expect(pending.nodeId).toBe("node-x");
    expect(pending.affectedClipIds.sort()).toEqual(["clip-a", "clip-b"]);
    expect(pending.selectedClipIds.sort()).toEqual(["clip-a", "clip-b"]);
    expect(pending.impactSentence).toContain("Cool Node");
  });

  it("toggles selection and supports select all / clear all", () => {
    const clips = {
      "clip-a": clip("clip-a", "Clip A"),
      "clip-b": clip("clip-b", "Clip B"),
    };
    const depMap: DependencyMap = {
      downstreamByNodeId: {},
      clipsByNodeId: { "node-x": ["clip-a", "clip-b"] },
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    };
    const start = PartialRerenderGate.computePending("node-x", "Cool Node", clips, depMap)!;
    const toggled = PartialRerenderGate.toggleSelection(start, "clip-a");
    expect(toggled.selectedClipIds.sort()).toEqual(["clip-b"]);
    const cleared = PartialRerenderGate.setAll(toggled, false);
    expect(cleared.selectedClipIds).toEqual([]);
    const selectedAll = PartialRerenderGate.setAll(cleared, true);
    expect(selectedAll.selectedClipIds.sort()).toEqual(["clip-a", "clip-b"]);
  });
});

