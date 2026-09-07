import { describe, expect, it } from "vitest";
import { performancePlanFromNode } from "../performance";
import { exportPerformancePlanToEdl, importPerformancePlanFromEdl } from "./edl";
import { importEditorialTimingFile } from "./interchange";
import {
  exportPerformancePlanToPremiereXml,
  importPerformancePlanFromPremiereXml,
} from "./premiereXml";

const basePlan = performancePlanFromNode({
  sources: [{ id: "take-3", type: "live_action", label: "Take 3", uri: "takes/3.mov", enabled: true }],
  cues: [],
});

const exchangeInput = {
  clipId: "clip-1",
  clipName: "Shot 010",
  durationFrames: 96,
  fps: 24,
  performancePlan: performancePlanFromNode({
    ...basePlan,
    cues: [{ id: "react", kind: "reaction", label: "Double take", direction: "Wait one beat.", startFrame: 24, endFrame: 36, actorId: "actor-a", sourceId: "take-3", overlapMode: "avoid" }],
    audioGuide: { label: "Premiere mix", uri: "file:///audio/mix.wav", offsetFrame: 0, durationFrames: 96 },
  }),
};

describe("Premiere XML editorial timing", () => {
  it("round-trips SceneForge cue metadata and edited audio", () => {
    const xml = exportPerformancePlanToPremiereXml(exchangeInput);
    const result = importPerformancePlanFromPremiereXml(xml, {
      basePlan: performancePlanFromNode({}),
      durationFrames: 96,
      fps: 24,
    });

    expect(xml).toContain("<xmeml version=\"5\">");
    expect(result.ok).toBe(true);
    expect(result.fps).toBe(24);
    expect(result.performancePlan?.cues[0]).toMatchObject({
      id: "react",
      kind: "reaction",
      actorId: "actor-a",
      startFrame: 24,
      endFrame: 36,
    });
    expect(result.performancePlan?.audioGuide?.uri).toBe("file:///audio/mix.wav");
    expect(result.performancePlan?.sources[0].id).toBe("take-3");
  });

  it("imports generic Premiere markers while preserving authored performance sources", () => {
    const xml = `<?xml version="1.0"?><xmeml version="5"><sequence><duration>96</duration><rate><timebase>24</timebase></rate><marker><name>Reaction</name><comment>Look back.</comment><in>12</in><out>20</out></marker></sequence></xmeml>`;
    const result = importPerformancePlanFromPremiereXml(xml, { basePlan, durationFrames: 96, fps: 24 });

    expect(result.ok).toBe(true);
    expect(result.performancePlan?.sources[0].id).toBe("take-3");
    expect(result.performancePlan?.cues[0]).toMatchObject({ kind: "reaction", startFrame: 12, endFrame: 20 });
    expect(result.warnings[0]).toContain("timing only");
  });
});

describe("CMX 3600 EDL editorial timing", () => {
  it("round-trips cue and audio timing through SceneForge comments", () => {
    const edl = exportPerformancePlanToEdl(exchangeInput);
    const result = importPerformancePlanFromEdl(edl, { basePlan, durationFrames: 96, fps: 24 });

    expect(edl).toContain("SCENEFORGE_CUE");
    expect(result.ok).toBe(true);
    expect(result.performancePlan?.cues[0]).toMatchObject({ id: "react", actorId: "actor-a" });
    expect(result.performancePlan?.audioGuide?.uri).toBe("file:///audio/mix.wav");
  });

  it("detects the interchange format from filename and content", () => {
    const result = importEditorialTimingFile("shot.edl", exportPerformancePlanToEdl(exchangeInput), {
      basePlan,
      durationFrames: 96,
      fps: 24,
    });
    expect(result.format).toBe("cmx3600_edl");
    expect(result.ok).toBe(true);
  });
});

