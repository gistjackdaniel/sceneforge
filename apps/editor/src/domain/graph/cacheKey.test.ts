import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "./types";
import {
  buildCacheKeyInput,
  computeContentHash,
  computeNodeContentHash,
} from "./cacheKey";
import { evaluateNodeWithCache } from "./nodeOutputCache";

const node = (overrides: Partial<NodeBase> = {}): NodeBase => {
  const ports = defaultPorts();
  return {
    id: "n1",
    name: "Hero Light",
    kind: "LightingRigNode",
    type: "LightingRigNode",
    category: "cinematic",
    scope: "project",
    enabled: true,
    tags: [],
    version: 1,
    referenceType: "shared",
    parameters: { intensity: 0.8 },
    params: { intensity: 0.8 },
    downstreamNodeIds: [],
    status: "clean",
    inputPorts: ports.inputPorts,
    outputPorts: ports.outputPorts,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
};

describe("cache key / content hash", () => {
  it("does not change when view-only camera visualization flags live on node.ui", () => {
    const params = { keyframes: [], interpolation: "linear" };
    const base = node({ kind: "CameraPathNode", type: "CameraPathNode", parameters: params, params });
    const withViz = node({
      kind: "CameraPathNode",
      type: "CameraPathNode",
      parameters: params,
      params,
      ui: { position: { x: 40, y: 80 } },
    });
    expect(computeNodeContentHash(withViz)).toBe(computeNodeContentHash(base));
  });

  it("is unchanged when display name or UI position changes", () => {
    const base = node();
    const renamed = node({ name: "Hero Light (renamed)" });
    const moved = node({
      ui: { position: { x: 120, y: 40 } },
      parameters: { intensity: 0.8, position: { x: 1, y: 2 } },
    });

    expect(computeNodeContentHash(renamed)).toBe(computeNodeContentHash(base));
    expect(computeNodeContentHash(moved)).toBe(computeNodeContentHash(base));
  });

  it("changes when evaluation params change", () => {
    const base = computeNodeContentHash(node());
    const brighter = computeNodeContentHash(node({ parameters: { intensity: 1.2 }, params: { intensity: 1.2 } }));
    expect(brighter).not.toBe(base);
  });

  it("is deterministic for equivalent CacheKeyInput", () => {
    const input = buildCacheKeyInput(node(), { inputHashes: ["b", "a"], assetVersionHashes: ["v2", "v1"] });
    expect(input.inputHashes).toEqual(["a", "b"]);
    expect(computeContentHash(input)).toBe(computeContentHash({ ...input }));
  });
});

describe("L1 node output cache", () => {
  it("hits when the same inputs are evaluated again", () => {
    const subject = node();
    let calls = 0;
    const first = evaluateNodeWithCache({}, subject, () => {
      calls += 1;
      return { pixels: 12 };
    }, "t1");
    const second = evaluateNodeWithCache(first.cache, subject, () => {
      calls += 1;
      return { pixels: 99 };
    }, "t2");

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual({ pixels: 12 });
    expect(calls).toBe(1);
  });

  it("misses after a param change", () => {
    const first = evaluateNodeWithCache({}, node(), () => "a", "t1");
    const second = evaluateNodeWithCache(
      first.cache,
      node({ parameters: { intensity: 0.1 }, params: { intensity: 0.1 } }),
      () => "b",
      "t2",
    );
    expect(second.hit).toBe(false);
    expect(second.value).toBe("b");
  });
});
