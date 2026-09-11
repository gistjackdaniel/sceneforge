import { describe, it, expect } from "vitest";
import { stubModelConnector } from "./modelConnectorStub";
import { normalizeRenderRequest } from "../../domain/rendering/request";

describe("Stub ModelConnector", () => {
  it("supports declared tasks and validates requests", async () => {
    const connector = stubModelConnector;
    expect(connector.supportedTasks()).toContain("image_to_world");
    const request = normalizeRenderRequest({
      task: "image_to_world",
      frameCount: 24,
      conditions: [
        { id: "prompt", type: "text", payload: { text: "hello" } },
        { id: "cam", type: "camera", payload: { label: "orbit", frameCount: 24 } },
      ],
      backendOptions: { note: "no-secrets" },
    });
    const validation = connector.validate(request);
    expect(validation.ok).toBe(true);
    const estimate = await connector.estimate(request);
    expect(estimate.seconds).toBeGreaterThan(0);
  });

  it("refuses secrets in backendOptions", () => {
    const connector = stubModelConnector;
    const request = normalizeRenderRequest({
      task: "image_to_world",
      conditions: [],
      backendOptions: { apiKey: "should-not-be-here" },
    });
    const validation = connector.validate(request);
    expect(validation.ok).toBe(false);
    expect(validation.issues.join(" ")).toMatch(/not allowed/);
  });

  it("executes and returns stub artifacts", async () => {
    const connector = stubModelConnector;
    const request = normalizeRenderRequest({
      task: "image_to_world",
      conditions: [{ id: "prompt", type: "text", payload: { text: "world gen" } }],
    });
    const result = await connector.execute(request);
    expect(result.requestId).toBe(request.requestId);
    expect(result.artifacts).toHaveProperty("generatedSegmentPath");
    expect(result.logs[0]).toMatch(/Executed image_to_world/);
  });
});

