export type ConditionType =
  | "text"
  | "image"
  | "video"
  | "depth"
  | "pose"
  | "mask"
  | "camera"
  | "motion"
  | "world_reference";

export interface ModelCondition {
  id: string;
  type: ConditionType;
  assetId?: string;
  payload?: Record<string, unknown>;
  weight?: number;
}

export type RenderTask =
  | "text_to_video"
  | "image_to_video"
  | "image_to_world"
  | "world_to_video"
  | "video_edit";

export interface RenderRequest {
  requestId: string;
  task: RenderTask;
  conditions: ModelCondition[];
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  seed?: number;
  backendOptions: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export interface ExecutionEstimate {
  seconds: number;
  costHint?: string;
}

export interface ModelExecutionResult {
  requestId: string;
  outputAssetIds: string[];
  artifacts: Record<string, unknown>;
  logs: string[];
}

export interface ModelConnector {
  id: string;
  supportedTasks(): string[];
  validate(request: RenderRequest): ValidationResult;
  estimate(request: RenderRequest): Promise<ExecutionEstimate>;
  execute(request: RenderRequest, signal?: AbortSignal): Promise<ModelExecutionResult>;
}

export type RenderQuality = "viewport" | "proxy" | "final";

export type RenderJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface RenderJob {
  id: string;
  clipId: string;
  renderNodeId: string;
  quality: RenderQuality;
  priority: number;
  cacheKey: string;
  status: RenderJobStatus;
  createdAt: string;
  errorMessage?: string;
  retryCount?: number;
}

export const DEFAULT_RENDER_BACKEND_VERSION = "stub-1";

export const normalizeRenderRequest = (input: Partial<RenderRequest> & { task: RenderTask }): RenderRequest => ({
  requestId: input.requestId ?? `req-${Date.now().toString(36)}`,
  task: input.task,
  conditions: input.conditions ?? [],
  frameCount: Math.max(1, input.frameCount ?? 24),
  fps: input.fps ?? 24,
  width: input.width ?? 1280,
  height: input.height ?? 720,
  seed: input.seed,
  backendOptions: input.backendOptions ?? {},
});

export const validateRenderRequest = (request: RenderRequest): ValidationResult => {
  const issues: string[] = [];
  if (request.frameCount < 1) {
    issues.push("frameCount must be >= 1");
  }
  if (request.fps < 1) {
    issues.push("fps must be >= 1");
  }
  if (request.width < 16 || request.height < 16) {
    issues.push("resolution is too small");
  }
  return { ok: issues.length === 0, issues };
};

/** playhead > visible > affected > background */
export const renderJobPriority = (input: {
  nearPlayhead: boolean;
  inVisibleRange: boolean;
  affected: boolean;
}): number => {
  if (input.nearPlayhead) {
    return 4000;
  }
  if (input.inVisibleRange) {
    return 3000;
  }
  if (input.affected) {
    return 2000;
  }
  return 1000;
};
