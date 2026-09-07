import { describe, expect, it } from "vitest";
import { migrateClipTiming, withClipTiming } from "./timing";
import { createClipVariant, setActiveVariant } from "./variants";
import { validateClipTemporalNodes } from "./temporalValidation";
import { defaultPorts, type NodeBase } from "../graph/types";
import type { TimelineClip } from "./types";

const clip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: "clip-1",
  name: "Shot",
  start: 0,
  end: 48,
  duration: 48,
  sourceType: "empty",
  clipGraphId: "g1",
  cacheStatus: "valid",
  ...overrides,
});

describe("clip timing", () => {
  it("migrates integer start/duration as frames", () => {
    const migrated = migrateClipTiming(clip({ start: 24, duration: 72, end: 96 }));
    expect(migrated.startFrame).toBe(24);
    expect(migrated.durationFrames).toBe(72);
    expect(migrated.end).toBe(96);
  });

  it("keeps startFrame when already present", () => {
    const migrated = migrateClipTiming(clip({ startFrame: 10, durationFrames: 20, start: 0, duration: 1 }));
    expect(migrated.startFrame).toBe(10);
    expect(migrated.durationFrames).toBe(20);
  });
});

describe("clip variants", () => {
  it("creates an override layer without cloning graph identity", () => {
    const original = clip({ clipGraphId: "graph-shared" });
    const variant = createClipVariant(original, "alt", "Alt Angle", { "node-cam": { focal: 85 } });
    expect(variant.clipGraphId).toBe("graph-shared");
    expect(variant.variants).toHaveLength(2);
    expect(variant.activeVariantId).toBe("alt");
    const switched = setActiveVariant(variant, "main");
    expect(switched.clipGraphId).toBe("graph-shared");
    expect(switched.activeVariantId).toBe("main");
    expect(switched.variants).toHaveLength(2);
  });
});

describe("temporal validation", () => {
  it("fails when CameraPath exceeds clip duration", () => {
    const ports = defaultPorts();
    const path: NodeBase = {
      id: "cam",
      name: "Camera Path",
      kind: "CameraPathNode",
      type: "CameraPathNode",
      category: "cinematic",
      scope: "clip",
      enabled: true,
      tags: [],
      version: 1,
      referenceType: "local",
      parameters: { keyframes: [{ frame: 0 }, { frame: 90 }] },
      params: { keyframes: [{ frame: 0 }, { frame: 90 }] },
      downstreamNodeIds: [],
      status: "clean",
      inputPorts: ports.inputPorts,
      outputPorts: ports.outputPorts,
      createdAt: "t",
      updatedAt: "t",
    };
    const result = validateClipTemporalNodes(withClipTiming(clip(), 0, 48), { cam: path }, ["cam"]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("초과");
  });

  it("fails when a performance cue ends outside the clip", () => {
    const ports = defaultPorts();
    const performance: NodeBase = {
      id: "performance",
      name: "Performance Direction",
      kind: "PerformancePlanNode",
      type: "PerformancePlanNode",
      category: "performance",
      scope: "clip",
      enabled: true,
      tags: [],
      version: 1,
      referenceType: "local",
      parameters: { cues: [{ startFrame: 40, endFrame: 60 }] },
      params: { cues: [{ startFrame: 40, endFrame: 60 }] },
      downstreamNodeIds: [],
      status: "clean",
      inputPorts: ports.inputPorts,
      outputPorts: ports.outputPorts,
      createdAt: "t",
      updatedAt: "t",
    };
    const result = validateClipTemporalNodes(
      withClipTiming(clip(), 0, 48),
      { performance },
      ["performance"],
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("초과");
  });
});
