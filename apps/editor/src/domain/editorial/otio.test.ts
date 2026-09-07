import { describe, expect, it } from "vitest";
import { performancePlanFromNode } from "../performance";
import {
  exportPerformancePlanToOtio,
  importPerformancePlanFromOtio,
  serializeOtio,
} from "./otio";

describe("OpenTimelineIO direction exchange", () => {
  it("round-trips edited audio and performance cues through namespaced OTIO metadata", () => {
    const plan = performancePlanFromNode({
      sources: [{ id: "actor-take", type: "live_action", label: "Take 3", uri: "takes/3.mov", enabled: true, qualityGate: { status: "approved", trackingConfidence: 0.94 } }],
      cues: [{ id: "line", kind: "dialogue", label: "Line", direction: "Dry", startFrame: 4, endFrame: 16, actorId: "actor-a", overlapMode: "allow" }],
      audioGuide: { label: "Premiere mix", uri: "audio/mix.wav", offsetFrame: 0, durationFrames: 48 },
    });
    const document = exportPerformancePlanToOtio({
      clipId: "clip-1",
      clipName: "Shot 010",
      durationFrames: 48,
      fps: 24,
      performancePlan: plan,
    });
    const result = importPerformancePlanFromOtio(JSON.parse(serializeOtio(document)));

    expect(document.OTIO_SCHEMA).toBe("Timeline.1");
    expect(JSON.stringify(document)).toContain("Marker.3");
    expect(JSON.stringify(document)).toContain("ExternalReference.1");
    expect(result.ok).toBe(true);
    expect(result.clipId).toBe("clip-1");
    expect(result.performancePlan?.audioGuide?.uri).toBe("audio/mix.wav");
    expect(result.performancePlan?.cues[0]).toMatchObject({ id: "line", actorId: "actor-a" });
    expect(result.performancePlan?.sources[0].qualityGate?.status).toBe("approved");
  });

  it("refuses generic OTIO without SceneForge metadata instead of guessing", () => {
    const result = importPerformancePlanFromOtio({ OTIO_SCHEMA: "Timeline.1", metadata: {} });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("SceneForge direction metadata");
  });
});

