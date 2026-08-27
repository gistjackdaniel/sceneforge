import type {
  ExecutionEstimate,
  ModelConnector,
  ModelExecutionResult,
  RenderRequest,
  ValidationResult,
} from "../../../domain/rendering/request";
import { validateRenderRequest } from "../../../domain/rendering/request";
import { lyraAdapter } from "../../../core/lyra";
import type { LyraAdapter } from "../../../core/lyra/types";

export class ConnectorCancelledError extends Error {
  constructor(message = "Connector execution cancelled") {
    super(message);
    this.name = "ConnectorCancelledError";
  }
}

export class ConnectorExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorExecutionError";
  }
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new ConnectorCancelledError();
  }
};

/**
 * ModelConnector wrapping existing Lyra adapters. Graph schema stays task-based.
 */
export const createLyraModelConnector = (adapter: LyraAdapter = lyraAdapter): ModelConnector => ({
  id: "lyra-2.0",
  supportedTasks: () => ["image_to_world", "world_to_video"],
  validate(request: RenderRequest): ValidationResult {
    const base = validateRenderRequest(request);
    if (!["image_to_world", "world_to_video"].includes(request.task)) {
      return { ok: false, issues: [...base.issues, `Unsupported task: ${request.task}`] };
    }
    return base;
  },
  async estimate(request: RenderRequest): Promise<ExecutionEstimate> {
    return { seconds: Math.max(2, Math.round(request.frameCount / 24)), costHint: "stub" };
  },
  async execute(request: RenderRequest, signal?: AbortSignal): Promise<ModelExecutionResult> {
    const validation = this.validate(request);
    if (!validation.ok) {
      throw new ConnectorExecutionError(validation.issues.join("; "));
    }
    throwIfAborted(signal);

    try {
      if (request.task === "world_to_video") {
        const clipId = String(request.backendOptions.clipId ?? "clip");
        const job = await adapter.submitVideoRenderJob({
          clipId,
          prompt: request.conditions.find((condition) => condition.type === "text")?.payload?.text as
            | string
            | undefined,
          keyframes: [],
          cameraTrajectory: {
            label: String(request.backendOptions.trajectoryLabel ?? "path"),
            frameCount: request.frameCount,
          },
          worldArtifacts: {
            spatialMemoryPath: String(request.backendOptions.spatialMemoryPath ?? ""),
            visualLayer3dgsPath: String(request.backendOptions.visualLayer3dgsPath ?? ""),
            surfaceMeshPath: String(request.backendOptions.surfaceMeshPath ?? ""),
          },
          memoryCoverage: Number(request.backendOptions.memoryCoverage ?? 0),
        });
        let current = job;
        while (current.status === "queued" || current.status === "running") {
          throwIfAborted(signal);
          current = await adapter.pollVideoRenderJob(current.jobId);
        }
        if (current.status !== "completed" || !current.output) {
          throw new ConnectorExecutionError(current.error ?? "Video render failed");
        }
        return {
          requestId: request.requestId,
          outputAssetIds: [],
          artifacts: { ...current.output },
          logs: [current.message],
        };
      }

      const image = request.conditions.find((condition) => condition.type === "image");
      const text = request.conditions.find((condition) => condition.type === "text");
      const camera = request.conditions.find((condition) => condition.type === "camera");
      const job = await adapter.submitJob({
        sourceImagePath: String(image?.payload?.path ?? request.backendOptions.sourceImagePath ?? "uploads/source.png"),
        sourceImageName: String(image?.payload?.name ?? "source.png"),
        cameraTrajectory: {
          label: String(camera?.payload?.label ?? "default orbit"),
          frameCount: request.frameCount,
        },
        prompt: typeof text?.payload?.text === "string" ? text.payload.text : undefined,
      });
      let current = job;
      while (current.status === "queued" || current.status === "running") {
        throwIfAborted(signal);
        current = await adapter.pollJob(current.jobId);
      }
      if (current.status !== "completed" || !current.output) {
        throw new ConnectorExecutionError(current.error ?? "World generation failed");
      }
      return {
        requestId: request.requestId,
        outputAssetIds: [],
        artifacts: { ...current.output },
        logs: [current.message],
      };
    } catch (error) {
      if (error instanceof ConnectorCancelledError) {
        throw error;
      }
      throw new ConnectorExecutionError(
        error instanceof Error ? error.message : "Connector execution failed",
      );
    }
  },
});

export const lyraModelConnector = createLyraModelConnector();
