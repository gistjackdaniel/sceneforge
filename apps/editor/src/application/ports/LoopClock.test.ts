import { describe, it, expect, vi } from "vitest";
import { createLoopClock } from "./LoopClock";
import { applyCommand } from "../commands/apply";
import type { Project } from "../../domain/project/types";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";

describe("LoopClock", () => {
  it("ticks in a loop and wraps at duration", () => {
    vi.useFakeTimers();
    // Force setTimeout path for test determinism
    // @ts-ignore
    const savedRaf = globalThis.requestAnimationFrame;
    // @ts-ignore
    delete (globalThis as any).requestAnimationFrame;
    const calls: number[] = [];
    const clock = createLoopClock({ duration: 0.2, fps: 10, autoplay: true });
    const unsub = clock.subscribe((t) => calls.push(t));
    expect(clock.isPlaying).toBe(true);
    vi.advanceTimersByTime(250);
    expect(calls.length).toBeGreaterThan(1);
    // All samples are within [0, duration)
    expect(calls.every((t) => t >= 0 && t < 0.2)).toBe(true);
    unsub();
    clock.stop();
    // restore
    // @ts-ignore
    if (savedRaf) globalThis.requestAnimationFrame = savedRaf;
    vi.useRealTimers();
  });

  it("keeps playing while commands apply", () => {
    vi.useFakeTimers();
    // @ts-ignore
    const savedRaf = globalThis.requestAnimationFrame;
    // @ts-ignore
    delete (globalThis as any).requestAnimationFrame;
    const clock = createLoopClock({ duration: 0.1, fps: 20, autoplay: true });
    const calls: number[] = [];
    const unsub = clock.subscribe((t) => calls.push(t));
    vi.advanceTimersByTime(30);
    expect(clock.isPlaying).toBe(true);
    // Apply a trivial command while ticking; ensure it doesn't affect clock
    const now = "2026-01-01T00:00:00.000Z";
    const ports = defaultPorts();
    const render: NodeBase = {
      id: "render",
      name: "Render",
      kind: "RenderSettingsNode",
      type: "RenderSettingsNode",
      category: "render",
      scope: "clip",
      enabled: true,
      tags: [],
      version: 1,
      referenceType: "local",
      parameters: {},
      params: {},
      downstreamNodeIds: [],
      status: "clean",
      inputPorts: ports.inputPorts,
      outputPorts: ports.outputPorts,
      createdAt: now,
      updatedAt: now,
    };
    const project: Project = {
      id: "p",
      name: "P",
      createdAt: now,
      updatedAt: now,
      metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
      activeSequenceId: "s",
      sequences: { s: { id: "s", name: "S", clipIds: [], playhead: 0, visibleRange: [0, 10] } },
      clips: {},
      clipGraphs: {},
      nodes: { render },
      references: {},
      dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
      worlds: {},
      assets: {},
      caches: {},
      connectors: {},
      libraryNodeIds: [],
    };
    const applied = applyCommand(project, { type: "INVALIDATE_CACHE", nodeId: "render" }, { timestamp: now });
    expect(applied.result.ok).toBe(true);
    vi.advanceTimersByTime(100);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    unsub();
    clock.stop();
    // @ts-ignore
    if (savedRaf) globalThis.requestAnimationFrame = savedRaf;
    vi.useRealTimers();
  });
});

