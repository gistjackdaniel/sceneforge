import { describe, expect, it } from "vitest";
import {
  createPerformancePlanNode,
  diffPerformancePlanDirectionInvalidations,
  performancePlanFromNode,
  performancePlanNodeIdForClip,
  validatePerformancePlan,
} from "./plan";

describe("performance direction plan", () => {
  it("normalizes persisted sources and sorts clip-local cues", () => {
    const plan = performancePlanFromNode({
      separationPolicy: "legacy-mixed",
      sources: [
        { id: "live", type: "live_action", label: "Actor take", uri: "takes/03.mov" },
      ],
      cues: [
        { id: "reaction", kind: "reaction", label: "Look", direction: "Hold, then glance.", startFrame: 18, endFrame: 24 },
        { id: "line", kind: "dialogue", label: "Line", direction: "Underplay.", startFrame: 2, endFrame: 12, sourceId: "live" },
      ],
    });

    expect(plan.separationPolicy).toBe("shot_and_performance");
    expect(plan.sources[0]).toMatchObject({ id: "live", type: "live_action", enabled: true });
    expect(plan.cues.map((cue) => cue.id)).toEqual(["line", "reaction"]);
    expect(plan.channelControls.camera.locked).toBe(true);
  });

  it("rejects invalid timing and dangling performance references", () => {
    const plan = performancePlanFromNode({
      sources: [],
      cues: [
        { id: "bad", kind: "reaction", label: "Late reaction", direction: "React.", startFrame: 20, endFrame: 60, sourceId: "missing" },
      ],
    });
    const result = validatePerformancePlan(plan, 48);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("outside the clip");
    expect(result.errors.join(" ")).toContain("no longer exists");
  });

  it("creates a dedicated node that forbids previs animation as acting input", () => {
    const node = createPerformancePlanNode("clip-7", "2026-01-01T00:00:00.000Z");

    expect(node.id).toBe(performancePlanNodeIdForClip("clip-7"));
    expect(node.kind).toBe("PerformancePlanNode");
    expect(node.category).toBe("performance");
    expect(node.tags).toContain("no-previs-animation");
  });

  it("scopes cue edits to their performance frames and audio edits to audio", () => {
    const previous = performancePlanFromNode({
      cues: [{ id: "beat", kind: "reaction", label: "Beat", direction: "Look", startFrame: 10, endFrame: 18 }],
      audioGuide: { label: "Mix", uri: "a.wav", offsetFrame: 0, durationFrames: 48 },
    });
    const next = performancePlanFromNode({
      ...previous,
      cues: [{ ...previous.cues[0], startFrame: 12, endFrame: 20 }],
      audioGuide: { ...previous.audioGuide!, uri: "b.wav" },
    });

    const changes = diffPerformancePlanDirectionInvalidations(previous, next);
    expect(changes.find((item) => item.channel === "performance_body")?.frameRanges).toEqual([
      { startFrame: 10, endFrame: 20 },
    ]);
    expect(changes.find((item) => item.channel === "audio")?.frameRanges).toEqual([
      { startFrame: 0, endFrame: 48 },
    ]);
  });

  it("blocks rejected capture sources and cyclic multi-character cue dependencies", () => {
    const plan = performancePlanFromNode({
      sources: [
        {
          id: "mocap",
          type: "motion_capture",
          label: "Bad capture",
          uri: "take.fbx",
          enabled: true,
          qualityGate: { status: "rejected", footSlidingScore: 0.8 },
        },
      ],
      cues: [
        { id: "a", kind: "dialogue", label: "A", direction: "Speak", startFrame: 0, endFrame: 10, reactionToCueId: "b" },
        { id: "b", kind: "reaction", label: "B", direction: "React", startFrame: 10, endFrame: 20, reactionToCueId: "a" },
      ],
    });

    const result = validatePerformancePlan(plan, 48);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("rejected performance source");
    expect(result.errors.join(" ")).toContain("dependency cycle");
    expect(result.warnings.join(" ")).toContain("foot sliding");
  });
});
