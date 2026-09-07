import type { ModelDirectionCapabilities } from "../../domain/rendering/capabilities";

/** Current Lyra connector contract. Cloud workers may override this after handshake. */
export const LYRA_DIRECTION_CAPABILITIES: ModelDirectionCapabilities = {
  connectorId: "lyra-2.0",
  label: "Lyra 2.0",
  tasks: ["image_to_world", "world_to_video"],
  channels: {
    camera: { mode: "exact", supportsLock: true, supportsStrength: true, supportsMask: false },
    structure: { mode: "exact", supportsLock: true, supportsStrength: true, supportsMask: true },
    performance_body: { mode: "reference", supportsLock: true, supportsStrength: true, supportsMask: true },
    performance_face: { mode: "reference", supportsLock: true, supportsStrength: true, supportsMask: true },
    audio: { mode: "exact", supportsLock: true, supportsStrength: false, supportsMask: false },
  },
  performanceSourceTypes: ["text_prompt", "live_action", "motion_capture", "key_animation_2d"],
  supportsFrameAccurateCues: true,
  supportsEditedAudio: true,
};

