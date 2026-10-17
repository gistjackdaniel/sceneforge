import { describe, it, expect } from "vitest";
import { validateOutputAspect } from "./recordingPreflight";

describe("recordingPreflight", () => {
  it("accepts known aspect presets", () => {
    expect(validateOutputAspect("16:9")).toBe(true);
    expect(validateOutputAspect("4:3")).toBe(true);
    expect(validateOutputAspect("9:16")).toBe(true);
    expect(validateOutputAspect("2.39:1")).toBe(true);
  });
  it("rejects invalid presets", () => {
    expect(validateOutputAspect("bad" as any)).toBe(false);
  });
});

