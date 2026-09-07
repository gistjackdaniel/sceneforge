import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "./types";
import type { DependencyMap } from "../project/clipGraph";
import { applyDirtyStatuses, collectDownstream, markDirty } from "./dirty";
import { invalidateCachesForNodeChange } from "../../core/cache/invalidation";
import type { RenderCacheEntry } from "../rendering/types";

const ports = defaultPorts();

const node = (
  id: string,
  extras: Partial<NodeBase> = {},
): NodeBase => ({
  id,
  name: extras.name ?? id,
  kind: extras.kind ?? "LightingRigNode",
  type: extras.kind ?? "LightingRigNode",
  category: "cinematic",
  scope: "project",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: extras.referenceType ?? "shared",
  parameters: extras.parameters ?? {},
  params: extras.parameters ?? {},
  downstreamNodeIds: extras.downstreamNodeIds ?? [],
  status: extras.status ?? "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("markDirty", () => {
  it("marks only the source node and its downstream dependents dirty", () => {
    const nodes = {
      light: node("light", { downstreamNodeIds: ["placement"] }),
      placement: node("placement", { kind: "ActorPlacementNode", downstreamNodeIds: ["render-a"] }),
      "render-a": node("render-a", { kind: "RenderSettingsNode" }),
      isolated: node("isolated", { kind: "CameraPathNode" }),
    };
    const dependencyMap: DependencyMap = {
      downstreamByNodeId: {
        light: ["placement"],
        placement: ["render-a"],
        "render-a": [],
        isolated: [],
      },
      clipsByNodeId: {
        light: ["clip-a"],
        placement: ["clip-a"],
        "render-a": ["clip-a"],
        isolated: ["clip-b"],
      },
      referencesByNodeId: {},
      cacheHashesByClipId: { "clip-a": "h-a", "clip-b": "h-b" },
    };

    const result = markDirty(
      { sourceNodeId: "light", reason: "params_changed", timestamp: "2026-01-02T00:00:00.000Z" },
      nodes,
      dependencyMap,
    );

    expect(result.dirtyNodeIds).toEqual(["light", "placement", "render-a"]);
    expect(result.affectedClipIds).toEqual(["clip-a"]);
    expect(result.dirtyNodeIds).not.toContain("isolated");

    const nextNodes = applyDirtyStatuses(nodes, result.dirtyNodeIds, "2026-01-02T00:00:00.000Z");
    expect(nextNodes.light.status).toBe("dirty");
    expect(nextNodes.placement.status).toBe("dirty");
    expect(nextNodes["render-a"].status).toBe("dirty");
    expect(nextNodes.isolated.status).toBe("clean");
  });

  it("does not include unconnected clips in the affected list", () => {
    const nodes = {
      shared: node("shared", { downstreamNodeIds: ["render-a"] }),
      "render-a": node("render-a", { kind: "RenderSettingsNode" }),
      local: node("local", { kind: "CameraPathNode", referenceType: "local" }),
    };
    const dependencyMap: DependencyMap = {
      downstreamByNodeId: { shared: ["render-a"], "render-a": [], local: [] },
      clipsByNodeId: { shared: ["clip-a"], "render-a": ["clip-a"], local: ["clip-b"] },
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    };
    const result = markDirty(
      { sourceNodeId: "shared", reason: "params_changed", timestamp: "t" },
      nodes,
      dependencyMap,
    );
    expect(result.affectedClipIds).toEqual(["clip-a"]);
  });
});

describe("collectDownstream", () => {
  it("includes the source and walks unique descendants", () => {
    expect(collectDownstream("a", { a: ["b", "c"], b: ["c"], c: [] })).toEqual(["a", "b", "c"]);
  });
});

describe("unconnected clip cache preservation", () => {
  it("keeps caches for clips that do not depend on the dirty node", () => {
    const nodes = {
      light: node("light", { downstreamNodeIds: ["render-a"] }),
      "render-a": node("render-a", { kind: "RenderSettingsNode" }),
    };
    const dependencyMap: DependencyMap = {
      downstreamByNodeId: { light: ["render-a"], "render-a": [] },
      clipsByNodeId: { light: ["clip-a"], "render-a": ["clip-a"] },
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    };
    const caches: Record<string, RenderCacheEntry> = {
      "cache-a": {
        id: "cache-a",
        clipId: "clip-a",
        label: "A",
        kind: "proxy",
        status: "valid",
        updatedAt: "t0",
        invalidatedByNodeIds: [],
      },
      "cache-b": {
        id: "cache-b",
        clipId: "clip-b",
        label: "B",
        kind: "proxy",
        status: "valid",
        updatedAt: "t0",
        invalidatedByNodeIds: [],
      },
    };

    const next = invalidateCachesForNodeChange(caches, dependencyMap, nodes.light, "t1");
    expect(next["cache-a"].status).toBe("invalid");
    expect(next["cache-a"].directionInvalidations).toEqual([{ channel: "structure" }]);
    expect(next["cache-b"].status).toBe("valid");
    expect(next["cache-b"].updatedAt).toBe("t0");
  });

  it("records a frame-scoped performance invalidation for partial rerender", () => {
    const performance = node("performance", {
      kind: "PerformancePlanNode",
      downstreamNodeIds: ["render-a"],
    });
    const dependencyMap: DependencyMap = {
      downstreamByNodeId: { performance: ["render-a"], "render-a": [] },
      clipsByNodeId: { performance: ["clip-a"], "render-a": ["clip-a"] },
      referencesByNodeId: {},
      cacheHashesByClipId: {},
    };
    const caches: Record<string, RenderCacheEntry> = {
      final: {
        id: "final",
        clipId: "clip-a",
        label: "Final",
        kind: "final",
        status: "valid",
        updatedAt: "t0",
        invalidatedByNodeIds: [],
      },
    };

    const next = invalidateCachesForNodeChange(caches, dependencyMap, performance, "t1", [
      { channel: "performance_face", frameRanges: [{ startFrame: 12, endFrame: 20 }] },
    ]);
    expect(next.final.directionInvalidations).toEqual([
      { channel: "performance_face", frameRanges: [{ startFrame: 12, endFrame: 20 }] },
    ]);
  });
});
