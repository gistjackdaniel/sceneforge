import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeshExampleWorld, createSplatExampleWorld } from "../sampleWorlds";
import type { TargetResolver } from "../query";
import {
  __setWorldGenLaneEnabledForTests,
  buildVideoWorldGenerationRequest,
  isWorldGenLaneEnabled,
  worldGenerationRequestSchema,
} from "./index";

const scopedWorlds = () => {
  const apartment = createMeshExampleWorld();
  const splat = createSplatExampleWorld();
  return {
    apartment,
    splat,
    worlds: { [apartment.id]: apartment, [splat.id]: splat },
  };
};

describe("VideoWorldGenerationAdapter", () => {
  beforeEach(() => {
    __setWorldGenLaneEnabledForTests(true);
  });
  afterEach(() => {
    __setWorldGenLaneEnabledForTests(undefined);
  });

  it("builds a request whose world references are WorldAsset ids", () => {
    const { apartment, splat, worlds } = scopedWorlds();
    const req = buildVideoWorldGenerationRequest({
      targetRef: apartment.id,
      baseRef: "Color Block Splats",
      worlds,
      resolveContext: { selectionIds: [], locale: "en" },
      referenceVideoAssetId: "asset-video-1",
      referenceVideoUri: "/tmp/input/ref.mp4",
      clipId: "clip-1",
      camera: { label: "generation-explore", frameCount: 48 },
      prompt: "track-in toward the window",
      seed: 7,
    });
    const parsed = worldGenerationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    expect(req.kind).toBe("video_to_world");
    expect(req.targetWorldAssetId).toBe(apartment.id);
    expect(req.baseWorldAssetId).toBe(splat.id);
    expect(req.conditions.find((condition) => condition.type === "text")).toBeTruthy();
    const world = req.conditions.find((condition) => condition.type === "world_reference");
    expect(world?.payload).toEqual({ worldAssetId: splat.id });
    const camera = req.conditions.find((condition) => condition.type === "camera");
    expect(camera?.payload).toMatchObject({ label: "generation-explore", frameCount: 48, clipId: "clip-1" });
    const video = req.conditions.find((condition) => condition.type === "video");
    expect(video?.assetId).toBe("asset-video-1");
    expect(video?.payload).toMatchObject({ path: "/tmp/input/ref.mp4", frameCount: 48, clipId: "clip-1" });
    expect(JSON.stringify(world)).not.toContain("Color Block Splats");
  });

  it("is gated by the feature flag and does not resolve while disabled", () => {
    __setWorldGenLaneEnabledForTests(false);
    expect(isWorldGenLaneEnabled()).toBe(false);
    const resolve = vi.fn<TargetResolver["resolve"]>(() => []);
    const { worlds } = scopedWorlds();
    expect(() =>
      buildVideoWorldGenerationRequest({
        targetRef: "Apartment Livingroom",
        worlds,
        resolver: { resolve },
        referenceVideoAssetId: "asset-1",
        referenceVideoUri: "ref.mp4",
        clipId: "clip-2",
        camera: { frameCount: 24 },
      }),
    ).toThrow(/disabled/i);
    expect(resolve).not.toHaveBeenCalled();
  });
});
