import { lyraJobStateSchema, lyraVideoRenderJobStateSchema } from "./schemas";
import { stubLyraAdapter } from "./stubAdapter";
import type {
  LyraAdapter,
  LyraJobState,
  LyraVideoRenderInput,
  LyraVideoRenderJobState,
  LyraWorldGenerateInput,
} from "./types";

const DEFAULT_CLOUD_BASE_URL = "http://localhost:8787";

const parseJobState = (payload: unknown): LyraJobState => lyraJobStateSchema.parse(payload);

const parseVideoJobState = (payload: unknown): LyraVideoRenderJobState =>
  lyraVideoRenderJobStateSchema.parse(payload);

/**
 * Cloud GPU worker adapter — submits jobs to services/lyra-worker API.
 * Falls back to stub when VITE_LYRA_CLOUD_URL is unset or request fails.
 */
export const createCloudLyraAdapter = (baseUrl = import.meta.env.VITE_LYRA_CLOUD_URL): LyraAdapter => {
  const resolvedBase = typeof baseUrl === "string" && baseUrl.length > 0 ? baseUrl : null;

  return {
    async submitJob(input: LyraWorldGenerateInput): Promise<LyraJobState> {
      if (!resolvedBase) {
        return stubLyraAdapter.submitJob(input);
      }
      try {
        const response = await fetch(`${resolvedBase}/jobs/world-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          throw new Error(`Cloud Lyra submit failed (${response.status})`);
        }
        return parseJobState(await response.json());
      } catch {
        return stubLyraAdapter.submitJob(input);
      }
    },

    async pollJob(jobId: string): Promise<LyraJobState> {
      if (!resolvedBase || jobId.startsWith("lyra-stub-")) {
        return stubLyraAdapter.pollJob(jobId);
      }
      try {
        const response = await fetch(`${resolvedBase}/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error(`Cloud Lyra poll failed (${response.status})`);
        }
        return parseJobState(await response.json());
      } catch {
        return stubLyraAdapter.pollJob(jobId);
      }
    },

    async submitVideoRenderJob(input: LyraVideoRenderInput): Promise<LyraVideoRenderJobState> {
      if (!resolvedBase) {
        return stubLyraAdapter.submitVideoRenderJob(input);
      }
      try {
        const response = await fetch(`${resolvedBase}/jobs/video-render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          throw new Error(`Cloud Lyra video render submit failed (${response.status})`);
        }
        return parseVideoJobState(await response.json());
      } catch {
        return stubLyraAdapter.submitVideoRenderJob(input);
      }
    },

    async pollVideoRenderJob(jobId: string): Promise<LyraVideoRenderJobState> {
      if (!resolvedBase || jobId.startsWith("lyra-video-stub-")) {
        return stubLyraAdapter.pollVideoRenderJob(jobId);
      }
      try {
        const response = await fetch(`${resolvedBase}/jobs/video-render/${jobId}`);
        if (!response.ok) {
          throw new Error(`Cloud Lyra video render poll failed (${response.status})`);
        }
        return parseVideoJobState(await response.json());
      } catch {
        return stubLyraAdapter.pollVideoRenderJob(jobId);
      }
    },
  };
};

export const cloudLyraAdapter = createCloudLyraAdapter();

/** Active adapter: cloud when URL configured, otherwise stub. */
export const lyraAdapter: LyraAdapter = cloudLyraAdapter;
