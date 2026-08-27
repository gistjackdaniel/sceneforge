import { describe, expect, it } from "vitest";
import { resolveShotState } from "./layers";
import type { WorldAsset } from "./types";
import type { Sequence } from "../timeline/types";
import type { TimelineClip } from "../timeline/types";

const world = (overrides: Partial<WorldAsset> = {}): WorldAsset => ({
  id: "world-1",
  name: "Cafe",
  description: "",
  representation: "hybrid",
  sourceAssetIds: [],
  rootUri: "worlds/cafe",
  coordinateSystem: "Y_UP",
  unitScaleMeters: 1,
  semanticTags: [],
  version: 1,
  createdAt: "t",
  updatedAt: "t",
  usdPath: "",
  semanticsPath: "",
  navmeshPath: "",
  previewPath: "",
  proxyKind: "usd",
  elements: [],
  props: [],
  ...overrides,
});

describe("resolveShotState", () => {
  it("applies sequence then clip overrides without mutating master world", () => {
    const master = world();
    const sequence: Sequence = {
      id: "seq",
      name: "Night",
      clipIds: ["c1"],
      playhead: 12,
      visibleRange: [0, 100],
      worldOverride: { timeOfDay: "night", rain: true },
    };
    const clip: TimelineClip = {
      id: "c1",
      name: "CU",
      start: 0,
      end: 48,
      duration: 48,
      sourceType: "empty",
      clipGraphId: "g",
      cacheStatus: "valid",
      linkedWorldId: "world-1",
      worldOverride: { heroPosition: [1, 0, 0], rain: false },
    };
    const resolved = resolveShotState({ world: master, sequence, clip, cameraFrame: 12 });
    expect(resolved.resolved.timeOfDay).toBe("night");
    expect(resolved.resolved.rain).toBe(false);
    expect(resolved.resolved.heroPosition).toEqual([1, 0, 0]);
    expect(resolved.layers.map((layer) => layer.scope)).toEqual(["master", "sequence", "clip"]);
    expect(master).toEqual(world());
    expect(resolved.cameraFrame).toBe(12);
  });
});
