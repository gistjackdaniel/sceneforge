import { describe, expect, it } from "vitest";
import { applyCommand } from "../../application/commands/apply";
import { migrateProject } from "../project/migrate";
import type { Project } from "../project/types";
import type { TimelineClip } from "./types";
import { createPersistentId, legacyShotId } from "./persistentId";
import {
  createShotForClip,
  ensureShotsForClips,
  frameToShotSeconds,
  shotFps,
  shotFpsForClip,
  shotFrameCount,
  shotSchema,
  shotTimeRange,
  withShotFrameLength,
} from "./shot";

const emptyDependencyMap = {
  downstreamByNodeId: {},
  clipsByNodeId: {},
  referencesByNodeId: {},
  cacheHashesByClipId: {},
};

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

const projectWith = (partial: Partial<Project> & Pick<Project, "clips" | "sequences">): Project => {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "project-1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    clipGraphs: {},
    nodes: {},
    references: {},
    dependencyMap: emptyDependencyMap,
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    ...partial,
  };
};

describe("Shot.fps", () => {
  it("stores a canonical positive fps and a shot-local frame range", () => {
    const shot = createShotForClip({ clip: clip({ durationFrames: 81, duration: 81 }), fps: 24 });
    expect(shotSchema.parse(shot).fps).toBe(24);
    expect(shotFps(shot)).toBe(24);
    expect(shotTimeRange(shot)).toEqual({ startFrame: 0, endFrame: 81 });
    expect(shotFrameCount(shot)).toBe(81);
    expect(frameToShotSeconds(24, shot)).toBe(1);
    expect(shotSchema.safeParse({ ...shot, fps: 0 }).success).toBe(false);
    expect(shotSchema.safeParse({ ...shot, fps: 23.976 }).success).toBe(false);
  });

  it("allocates prefixed ULID ids and stable legacy ids", () => {
    expect(createPersistentId("sht", 1_700_000_000_000)).toMatch(/^sht_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(legacyShotId("clip-001")).toBe(legacyShotId("clip-001"));
    expect(legacyShotId("clip-001")).not.toBe(legacyShotId("clip_001"));
  });

  it("migrates a clip without fps to 24 and keeps an existing shot fps", () => {
    const base = projectWith({
      sequences: {
        "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-1"], playhead: 0, visibleRange: [0, 100] },
      },
      clips: { "clip-1": clip({ start: 0, end: 100, duration: 100 }) },
    });
    const migrated = migrateProject(base, {
      buildDependencyMap: () => emptyDependencyMap,
      syncClipCacheFields: (item) => item,
    });
    const shotId = migrated.clips["clip-1"].shotId ?? "";
    expect(migrated.shots?.[shotId]?.fps).toBe(24);
    expect(migrated.shots?.[shotId]?.timeRange).toEqual({ startFrame: 0, endFrame: 100 });

    const custom = {
      ...migrated,
      sequences: {
        ...migrated.sequences,
        "seq-1": { ...migrated.sequences["seq-1"], fps: 30 },
      },
      shots: {
        [shotId]: { ...migrated.shots![shotId], fps: 48 },
      },
    };
    const again = migrateProject(custom, {
      buildDependencyMap: () => emptyDependencyMap,
      syncClipCacheFields: (item) => item,
    });
    expect(again.clips["clip-1"].shotId).toBe(shotId);
    expect(again.shots?.[shotId]?.fps).toBe(48);
  });

  it("copies a declared sequence fps and converts seconds with that same rate", () => {
    const migrated = migrateProject(
      projectWith({
        sequences: {
          "seq-1": {
            id: "seq-1",
            name: "Main",
            clipIds: ["clip-1"],
            playhead: 0,
            visibleRange: [0, 10],
            fps: 30,
          },
        },
        clips: { "clip-1": clip({ start: 0, end: 2.5, duration: 2.5 }) },
      }),
      {
        buildDependencyMap: () => emptyDependencyMap,
        syncClipCacheFields: (item) => item,
      },
    );
    const shot = migrated.shots?.[migrated.clips["clip-1"].shotId ?? ""];
    expect(shot?.fps).toBe(30);
    expect(shot?.timeRange).toEqual({ startFrame: 0, endFrame: 75 });
    expect(shotFpsForClip(migrated, "clip-1")).toBe(30);
  });

  it("falls back to 24 only when the shot document is absent", () => {
    const source = projectWith({
      sequences: {
        "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-1"], playhead: 0, visibleRange: [0, 10], fps: 0 },
      },
      clips: { "clip-1": clip() },
    });
    expect(shotFpsForClip(source, "clip-1")).toBe(24);
  });

  it("resizes the shot-local range with clip timing without changing fps", () => {
    const shot = createShotForClip({ clip: clip({ durationFrames: 48, duration: 48 }), fps: 24 });
    const project = projectWith({
      sequences: {
        "seq-1": { id: "seq-1", name: "Main", clipIds: ["clip-1"], playhead: 0, visibleRange: [0, 80] },
      },
      clips: { "clip-1": { ...clip({ durationFrames: 48, duration: 48, startFrame: 0 }), shotId: shot.id } },
      shots: { [shot.id]: shot },
    });
    const applied = applyCommand(
      project,
      { type: "UPDATE_CLIP_TIMING", clipId: "clip-1", startFrame: 4, durationFrames: 60 },
      { timestamp: "2026-01-02T00:00:00.000Z" },
    );
    expect(applied.result.ok).toBe(true);
    expect(applied.project.shots?.[shot.id]).toEqual(withShotFrameLength(shot, 60));
    expect(shotFps(applied.project.shots![shot.id])).toBe(24);
    expect(shotTimeRange(applied.project.shots![shot.id])).toEqual({ startFrame: 0, endFrame: 60 });
  });

  it("is idempotent for clips that already have frame fields", () => {
    const input = {
      clips: { "clip-1": clip({ startFrame: 12, durationFrames: 40, start: 12, duration: 40 }) },
      sequences: {
        "seq-1": {
          id: "seq-1",
          name: "Main",
          clipIds: ["clip-1"],
          playhead: 0,
          visibleRange: [0, 80] as [number, number],
          fps: 25,
        },
      },
    };
    const first = ensureShotsForClips(input);
    const second = ensureShotsForClips({ ...input, clips: first.clips, shots: first.shots });
    expect(second.shots).toEqual(first.shots);
    expect(second.clips["clip-1"].shotId).toBe(first.clips["clip-1"].shotId);
    expect(shotTimeRange(Object.values(first.shots)[0])).toEqual({ startFrame: 0, endFrame: 40 });
    expect(first.clips["clip-1"].startFrame).toBe(12);
  });
});
