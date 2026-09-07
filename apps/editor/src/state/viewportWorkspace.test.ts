import { describe, expect, it } from "vitest";
import { parseViewportWorkspace } from "./viewportWorkspace";

describe("parseViewportWorkspace", () => {
  it("prefers the explicit workspace field", () => {
    expect(parseViewportWorkspace({ viewportWorkspace: "record", shotCameraActive: false })).toBe("record");
    expect(parseViewportWorkspace({ viewportWorkspace: "build", shotCameraActive: true })).toBe("build");
  });

  it("migrates legacy shotCameraActive into Record", () => {
    expect(parseViewportWorkspace({ shotCameraActive: true })).toBe("record");
    expect(parseViewportWorkspace({})).toBe("build");
  });
});
