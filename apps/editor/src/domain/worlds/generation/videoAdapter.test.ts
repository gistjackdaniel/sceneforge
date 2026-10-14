import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setWorldGenLaneEnabledForTests,
  isWorldGenLaneEnabled,
  buildVideoWorldGenerationRequest,
  worldGenerationRequestSchema,
} from "./index";

describe("VideoWorldGenerationAdapter", () => {
  beforeEach(() => {
    __setWorldGenLaneEnabledForTests(true);
  });
  afterEach(() => {
    __setWorldGenLaneEnabledForTests(undefined);
  });

  it("builds a request with video, camera, and optional prompt", () => {
    const req = buildVideoWorldGenerationRequest({
      targetWorldAssetId: "world-target-1",
      baseWorldAssetId: "world-base-1",
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
    expect(req.baseWorldAssetId).toBe("world-base-1");
    expect(req.targetWorldAssetId).toBe("world-target-1");
    expect(req.conditions.find((c) => c.type === "text")).toBeTruthy();
    expect(req.conditions.find((c) => c.type === "world_reference")).toBeTruthy();
    const camera = req.conditions.find((c) => c.type === "camera");
    expect(camera?.payload).toMatchObject({ label: "generation-explore", frameCount: 48, clipId: "clip-1" });
    const video = req.conditions.find((c) => c.type === "video");
    expect(video?.assetId).toBe("asset-video-1");
    expect(video?.payload).toMatchObject({ path: "/tmp/input/ref.mp4", frameCount: 48, clipId: "clip-1" });
  });

  it("is gated by feature flag (throws when disabled)", () => {
    __setWorldGenLaneEnabledForTests(false);
    expect(isWorldGenLaneEnabled()).toBe(false);
    expect(() =>
      buildVideoWorldGenerationRequest({
        targetWorldAssetId: "world-y",
        referenceVideoAssetId: "asset-1",
        referenceVideoUri: "ref.mp4",
        clipId: "clip-2",
        camera: { frameCount: 24 },
      }),
    ).toThrow();
  });
});

