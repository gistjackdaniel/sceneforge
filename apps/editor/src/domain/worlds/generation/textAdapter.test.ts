import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setWorldGenLaneEnabledForTests,
  isWorldGenLaneEnabled,
  buildTextWorldGenerationRequest,
  worldGenerationRequestSchema,
} from "./index";

describe("TextWorldGenerationAdapter", () => {
  beforeEach(() => {
    __setWorldGenLaneEnabledForTests(true);
  });
  afterEach(() => {
    __setWorldGenLaneEnabledForTests(undefined);
  });

  it("builds a minimal request with prompt and target world id", () => {
    const req = buildTextWorldGenerationRequest({
      prompt: "a cozy apartment living room, natural light",
      targetWorldAssetId: "world-new-1",
    });
    const parsed = worldGenerationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    expect(req.kind).toBe("text_to_world");
    expect(req.targetWorldAssetId).toBe("world-new-1");
    expect(req.conditions.find((c) => c.type === "text")?.payload).toEqual({ text: "a cozy apartment living room, natural light" });
  });

  it("respects optional baseWorldAssetId and seed", () => {
    const req = buildTextWorldGenerationRequest({
      prompt: "wide corridor with windows",
      targetWorldAssetId: "world-new-2",
      baseWorldAssetId: "world-existing-1",
      seed: 42,
    });
    const parsed = worldGenerationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    expect(req.baseWorldAssetId).toBe("world-existing-1");
    expect(req.seed).toBe(42);
  });

  it("is gated by feature flag (throws when disabled)", () => {
    __setWorldGenLaneEnabledForTests(false);
    expect(isWorldGenLaneEnabled()).toBe(false);
    expect(() =>
      buildTextWorldGenerationRequest({
        prompt: "any",
        targetWorldAssetId: "world-x",
      }),
    ).toThrow();
  });
});

