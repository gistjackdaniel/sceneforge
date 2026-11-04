import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeshExampleWorld, createSplatExampleWorld } from "../sampleWorlds";
import type { TargetResolver } from "../query";
import {
  __setWorldGenLaneEnabledForTests,
  buildTextWorldGenerationRequest,
  isWorldGenLaneEnabled,
  worldGenerationRequestSchema,
} from "./index";

const scopedWorlds = () => {
  const apartment = createMeshExampleWorld();
  apartment.aliases = ["거실"];
  apartment.localizedNames = { ko: "아파트 거실" };
  const splat = createSplatExampleWorld();
  return {
    apartment,
    splat,
    worlds: { [apartment.id]: apartment, [splat.id]: splat },
  };
};

describe("TextWorldGenerationAdapter", () => {
  beforeEach(() => {
    __setWorldGenLaneEnabledForTests(true);
  });
  afterEach(() => {
    __setWorldGenLaneEnabledForTests(undefined);
  });

  it("stores only the resolved WorldAsset.id for the target and the base", () => {
    const { apartment, splat, worlds } = scopedWorlds();
    const req = buildTextWorldGenerationRequest({
      prompt: "a cozy apartment living room, natural light",
      targetRef: "거실",
      baseRef: splat.id,
      worlds,
      resolveContext: { selectionIds: [], locale: "ko" },
      seed: 42,
    });
    const parsed = worldGenerationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    expect(req.kind).toBe("text_to_world");
    expect(req.targetWorldAssetId).toBe(apartment.id);
    expect(req.baseWorldAssetId).toBe(splat.id);
    expect(req.seed).toBe(42);
    expect(req.conditions.find((condition) => condition.type === "text")?.payload).toEqual({
      text: "a cozy apartment living room, natural light",
    });
    expect(JSON.stringify(req)).not.toContain("아파트 거실");
    expect(JSON.stringify(req)).not.toContain("거실");
  });

  it("assigns a distinct request id on each build", () => {
    const { apartment, worlds } = scopedWorlds();
    const first = buildTextWorldGenerationRequest({
      prompt: "one",
      targetRef: apartment.id,
      worlds,
    });
    const second = buildTextWorldGenerationRequest({
      prompt: "two",
      targetRef: apartment.id,
      worlds,
    });
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.requestId.startsWith("wreq-")).toBe(true);
    expect(second.requestId.startsWith("wreq-")).toBe(true);
  });

  it("is gated by the feature flag and does not resolve while disabled", () => {
    __setWorldGenLaneEnabledForTests(false);
    expect(isWorldGenLaneEnabled()).toBe(false);
    const resolve = vi.fn<TargetResolver["resolve"]>(() => []);
    const { worlds } = scopedWorlds();
    expect(() =>
      buildTextWorldGenerationRequest({
        prompt: "any",
        targetRef: "거실",
        worlds,
        resolver: { resolve },
      }),
    ).toThrow(/disabled/i);
    expect(resolve).not.toHaveBeenCalled();
  });
});
