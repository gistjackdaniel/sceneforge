import { describe, expect, it } from "vitest";
import { defaultDirectionChannelControls } from "../direction";
import {
  negotiateDirectionCapabilities,
  type ModelDirectionCapabilities,
} from "./capabilities";

const limitedConnector: ModelDirectionCapabilities = {
  connectorId: "limited",
  label: "Limited Model",
  tasks: ["world_to_video"],
  channels: {
    camera: { mode: "reference", supportsLock: false, supportsStrength: false, supportsMask: false },
    structure: { mode: "exact", supportsLock: true, supportsStrength: true, supportsMask: false },
    performance_body: { mode: "prompt", supportsLock: false, supportsStrength: false, supportsMask: false },
    performance_face: { mode: "unsupported", supportsLock: false, supportsStrength: false, supportsMask: false },
    audio: { mode: "unsupported", supportsLock: false, supportsStrength: false, supportsMask: false },
  },
  performanceSourceTypes: ["text_prompt"],
  supportsFrameAccurateCues: false,
  supportsEditedAudio: false,
};

describe("direction capability negotiation", () => {
  it("makes every connector downgrade explicit", () => {
    const controls = defaultDirectionChannelControls();
    controls.performance_body.mask = { uri: "mask.png" };
    const result = negotiateDirectionCapabilities(controls, limitedConnector, {
      performanceSourceTypes: ["text_prompt", "live_action"],
      hasFrameAccurateCues: true,
      hasEditedAudio: true,
    });

    expect(result.channels.find((item) => item.channel === "camera")).toMatchObject({
      status: "degraded",
      applied: { locked: false, strength: 1 },
    });
    expect(result.channels.find((item) => item.channel === "performance_face")?.status).toBe("unsupported");
    expect(result.rejectedPerformanceSourceTypes).toEqual(["live_action"]);
    expect(result.frameAccurateCues).toBe("degraded");
    expect(result.editedAudio).toBe("degraded");
    expect(result.warnings.length).toBeGreaterThan(3);
  });
});

