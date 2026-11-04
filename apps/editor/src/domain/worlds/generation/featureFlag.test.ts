import { afterEach, describe, expect, it } from "vitest";
import { __setWorldGenLaneEnabledForTests, isWorldGenLaneEnabled, WORLD_GEN_LANE_FLAG_NAME } from "./index";

describe("World Generation lane feature flag", () => {
  afterEach(() => {
    __setWorldGenLaneEnabledForTests(undefined);
  });

  it("stays OFF when tests force the flag off, even if the Vite env is on", () => {
    __setWorldGenLaneEnabledForTests(false);
    expect(isWorldGenLaneEnabled()).toBe(false);
  });

  it("follows VITE_FEATURE_WORLD_GEN_LANE only when no test override is set", () => {
    __setWorldGenLaneEnabledForTests(undefined);
    const flag = (import.meta as { env?: Record<string, unknown> }).env?.[WORLD_GEN_LANE_FLAG_NAME];
    expect(isWorldGenLaneEnabled()).toBe(String(flag ?? "") === "1");
  });

  it("exposes the stable flag name", () => {
    expect(WORLD_GEN_LANE_FLAG_NAME).toBe("VITE_FEATURE_WORLD_GEN_LANE");
  });
});
