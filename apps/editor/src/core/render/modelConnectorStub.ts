import {
  type ExecutionEstimate,
  type ModelConnector,
  type ModelExecutionResult,
  type RenderRequest,
  type ValidationResult,
} from "../../domain/rendering/request";
import {
  type ModelDirectionCapabilities,
  negotiateDirectionCapabilities,
} from "../../domain/rendering/capabilities";
import { defaultDirectionChannelControls } from "../../domain/direction";

export const STUB_DIRECTION_CAPABILITIES: ModelDirectionCapabilities = {
  connectorId: "stub",
  label: "Stub Model Connector",
  tasks: ["text_to_video", "image_to_video", "image_to_world", "world_to_video", "video_edit"],
  channels: {
    camera: { mode: "reference", supportsLock: true, supportsStrength: true, supportsMask: false },
    structure: { mode: "reference", supportsLock: true, supportsStrength: true, supportsMask: true },
    performance_body: { mode: "prompt", supportsLock: false, supportsStrength: true, supportsMask: false },
    performance_face: { mode: "prompt", supportsLock: false, supportsStrength: true, supportsMask: false },
    audio: { mode: "unsupported", supportsLock: false, supportsStrength: false, supportsMask: false },
  },
  performanceSourceTypes: ["text_prompt", "live_action", "motion_capture", "key_animation_2d"],
  supportsFrameAccurateCues: false,
  supportsEditedAudio: false,
};

const hasForbiddenSecrets = (options: Record<string, unknown>): string[] => {
  const forbiddenKeys = ["apikey", "api_key", "secret", "token", "bearer", "authorization"];
  const issues: string[] = [];
  Object.keys(options).forEach((key) => {
    const lower = key.toLowerCase();
    if (forbiddenKeys.includes(lower)) {
      issues.push(`backendOptions.${key} is not allowed (secrets are refused by stub).`);
    }
  });
  return issues;
};

export const createStubModelConnector = (): ModelConnector => ({
  id: "model-stub",
  supportedTasks: () => STUB_DIRECTION_CAPABILITIES.tasks,
  capabilities: () => STUB_DIRECTION_CAPABILITIES,
  validate(request: RenderRequest): ValidationResult {
    const issues: string[] = [];
    if (!STUB_DIRECTION_CAPABILITIES.tasks.includes(request.task)) {
      issues.push(`Unsupported task: ${request.task}`);
    }
    if (!Array.isArray(request.conditions)) {
      issues.push("conditions must be an array");
    }
    issues.push(...hasForbiddenSecrets(request.backendOptions));
    return { ok: issues.length === 0, issues };
  },
  async estimate(request: RenderRequest): Promise<ExecutionEstimate> {
    return { seconds: Math.max(1, Math.round(request.frameCount / 24)), costHint: "stub" };
  },
  async execute(request: RenderRequest, signal?: AbortSignal): Promise<ModelExecutionResult> {
    if (signal?.aborted) {
      const error = new Error("Cancelled");
      error.name = "ConnectorCancelledError";
      throw error;
    }
    const validation = this.validate(request);
    if (!validation.ok) {
      const error = new Error(validation.issues.join("; "));
      error.name = "ConnectorExecutionError";
      throw error;
    }
    // Stub negotiation to demonstrate contract; authoring controls are not provided here.
    const negotiation = negotiateDirectionCapabilities(
      defaultDirectionChannelControls(),
      STUB_DIRECTION_CAPABILITIES,
      { performanceSourceTypes: [], hasFrameAccurateCues: false, hasEditedAudio: false },
    );
    const baseDir = `artifacts/${request.requestId}`;
    const artifacts =
      request.task === "image_to_world"
        ? {
            generatedSegmentPath: `${baseDir}/generated_segment_stub.mp4`,
            spatialMemoryPath: `${baseDir}/spatial_memory_stub.bin`,
            previewImagePath: `${baseDir}/preview.jpg`,
            capabilityNegotiation: negotiation,
          }
        : {
            videoPath: `${baseDir}/render_stub.mp4`,
            capabilityNegotiation: negotiation,
          };
    return {
      requestId: request.requestId,
      outputAssetIds: [],
      artifacts,
      logs: [`Executed ${request.task} via stub`],
    };
  },
});

export const stubModelConnector = createStubModelConnector();

