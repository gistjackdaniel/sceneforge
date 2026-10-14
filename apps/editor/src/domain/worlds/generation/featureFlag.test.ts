import { describe, it, expect } from "vitest";
import { isWorldGenLaneEnabled, WORLD_GEN_LANE_FLAG_NAME } from "./index";

describe("World Generation lane feature flag", () => {
  it("defaults to OFF", () => {
    expect(isWorldGenLaneEnabled()).toBe(false);
  });

  it("exposes the stable flag name", () => {
    expect(WORLD_GEN_LANE_FLAG_NAME).toBe("VITE_FEATURE_WORLD_GEN_LANE");
  });
});

