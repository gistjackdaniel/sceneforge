import { describe, it, expect } from "vitest";
import { GenerationConditionNormalizer, type SceneSignals } from "./conditionNormalizer";

describe("GenerationConditionNormalizer", () => {
  it("orders subject images before world background reference", () => {
    const input: SceneSignals = {
      clipId: "clip-1",
      subjects: [
        {
          subjectId: "actor-1",
          role: "person",
          views: [
            { assetId: "asset-front", viewTag: "front" },
            { assetId: "asset-side", viewTag: "side" },
          ],
        },
      ],
      world: { spatialMemoryAssetId: "mem-1", generatedSegmentAssetId: "seg-1" },
      camera: { label: "shot-a", frameCount: 24 },
    };

    const { conditions } = GenerationConditionNormalizer.normalize(input);
    const firstImageIndex = conditions.findIndex((c) => c.type === "image");
    const worldIndex = conditions.findIndex((c) => c.type === "world_reference");
    expect(firstImageIndex).toBeGreaterThanOrEqual(0);
    expect(worldIndex).toBeGreaterThan(firstImageIndex);
  });

  it("preserves subject viewTag order and values", () => {
    const input: SceneSignals = {
      clipId: "clip-2",
      subjects: [
        {
          subjectId: "car-1",
          role: "object",
          views: [
            { assetId: "a", viewTag: "threequarter" },
            { assetId: "b", viewTag: "back" },
          ],
        },
      ],
    };
    const { conditions, subjectViews } = GenerationConditionNormalizer.normalize(input);
    const imageConds = conditions.filter((c) => c.type === "image" && c.payload?.subjectId === "car-1");
    expect(imageConds.map((c) => c.payload?.viewTag)).toEqual(["threequarter", "back"]);
    expect(subjectViews[0]).toEqual({ subjectId: "car-1", role: "object", views: ["threequarter", "back"] });
  });
});

