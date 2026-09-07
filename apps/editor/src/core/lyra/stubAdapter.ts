import type {
  LyraAdapter,
  LyraJobState,
  LyraVideoRenderInput,
  LyraVideoRenderJobState,
  LyraVideoRenderOutput,
  LyraWorldGenerateInput,
  LyraWorldGenerateOutput,
} from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildStubOutput = (jobId: string, input: LyraWorldGenerateInput): LyraWorldGenerateOutput => ({
  jobId,
  generatedSegmentPath: `artifacts/${jobId}/generated_segment.mp4`,
  spatialMemoryPath: `artifacts/${jobId}/spatial_memory/`,
  visualLayer3dgsPath: `artifacts/${jobId}/reconstructed_scene.ply`,
  surfaceMeshPath: `artifacts/${jobId}/surface_mesh.glb`,
  navmeshPath: `artifacts/${jobId}/navmesh.bin`,
  memoryCoverage: 0.78,
  generatedAreaRatio: 0.22,
});

const buildStubVideoOutput = (jobId: string): LyraVideoRenderOutput => ({
  jobId,
  renderedVideoPath: `artifacts/${jobId}/rendered_clip.mp4`,
  consistencyScore: 0.91,
  usedMemoryCoverage: 0.78,
});

const jobs = new Map<string, LyraJobState>();
const videoJobs = new Map<string, LyraVideoRenderJobState>();

/**
 * Local stub adapter — simulates Lyra job lifecycle without GPU.
 * Replace with cloudAdapter when GPU worker is available.
 */
export const createStubLyraAdapter = (): LyraAdapter => ({
  async submitJob(input: LyraWorldGenerateInput): Promise<LyraJobState> {
    const jobId = `lyra-stub-${Date.now().toString(36)}`;
    const state: LyraJobState = {
      jobId,
      status: "queued",
      progress: 0,
      message: "Job queued (stub)",
      input,
    };
    jobs.set(jobId, state);
    return state;
  },

  async pollJob(jobId: string): Promise<LyraJobState> {
    const current = jobs.get(jobId);
    if (!current) {
      throw new Error("Lyra job not found");
    }

    if (current.status === "completed" || current.status === "failed") {
      return current;
    }

    const nextProgress = Math.min(current.progress + 0.34, 1);
    if (nextProgress < 1) {
      const running: LyraJobState = {
        ...current,
        status: "running",
        progress: nextProgress,
        message: `Generating world… ${Math.round(nextProgress * 100)}%`,
      };
      jobs.set(jobId, running);
      await delay(400);
      return running;
    }

    const completed: LyraJobState = {
      ...current,
      status: "completed",
      progress: 1,
      message: "World generation complete (stub)",
      output: buildStubOutput(jobId, current.input),
    };
    jobs.set(jobId, completed);
    return completed;
  },

  async cancelJob(jobId: string): Promise<void> {
    const current = jobs.get(jobId);
    if (!current || current.status === "completed") {
      return;
    }
    jobs.set(jobId, {
      ...current,
      status: "failed",
      message: "Cancelled",
      error: "cancelled",
    });
  },

  async submitVideoRenderJob(input: LyraVideoRenderInput): Promise<LyraVideoRenderJobState> {
    const jobId = `lyra-video-stub-${Date.now().toString(36)}`;
    const state: LyraVideoRenderJobState = {
      jobId,
      status: "queued",
      progress: 0,
      message: "Video render queued (stub)",
      input,
    };
    videoJobs.set(jobId, state);
    return state;
  },

  async pollVideoRenderJob(jobId: string): Promise<LyraVideoRenderJobState> {
    const current = videoJobs.get(jobId);
    if (!current) {
      throw new Error("Lyra video render job not found");
    }

    if (current.status === "completed" || current.status === "failed") {
      return current;
    }

    const nextProgress = Math.min(current.progress + 0.33, 1);
    if (nextProgress < 1) {
      const running: LyraVideoRenderJobState = {
        ...current,
        status: "running",
        progress: nextProgress,
        message: `Rendering with SpatialMemoryCache… ${Math.round(nextProgress * 100)}%`,
      };
      videoJobs.set(jobId, running);
      await delay(500);
      return running;
    }

    const completed: LyraVideoRenderJobState = {
      ...current,
      status: "completed",
      progress: 1,
      message: "Generative video render complete (stub)",
      output: buildStubVideoOutput(jobId),
    };
    videoJobs.set(jobId, completed);
    return completed;
  },
});

export const stubLyraAdapter = createStubLyraAdapter();
