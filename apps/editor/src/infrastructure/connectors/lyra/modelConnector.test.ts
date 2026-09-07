import { describe, expect, it } from "vitest";
import { createLyraModelConnector } from "./modelConnector";
import { createStubLyraAdapter } from "../../../core/lyra/stubAdapter";
import { normalizeRenderRequest } from "../../../domain/rendering/request";

describe("Lyra ModelConnector", () => {
  it("executes image_to_world via stub without changing graph schema", async () => {
    const connector = createLyraModelConnector(createStubLyraAdapter());
    expect(connector.supportedTasks()).toContain("image_to_world");
    expect(connector.capabilities().channels.camera.mode).toBe("exact");
    const request = normalizeRenderRequest({
      task: "image_to_world",
      conditions: [
        { id: "img", type: "image", payload: { path: "uploads/a.png", name: "a.png" } },
        { id: "cam", type: "camera", payload: { label: "orbit" } },
      ],
      frameCount: 24,
    });
    const result = await connector.execute(request);
    expect(result.requestId).toBe(request.requestId);
    expect(result.artifacts.visualLayer3dgsPath).toBeTruthy();
  });

  it("cancels via AbortSignal", async () => {
    const connector = createLyraModelConnector(createStubLyraAdapter());
    const controller = new AbortController();
    controller.abort();
    const request = normalizeRenderRequest({ task: "image_to_world", conditions: [] });
    await expect(connector.execute(request, controller.signal)).rejects.toThrow(/cancelled/i);
  });
});
