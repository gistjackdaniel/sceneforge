import { z } from "zod";
import { parseShotModelInput } from "../../../domain/shot";
import type { ShotModelInput } from "../../../domain/shot";

export type VideoJobStatus = "succeeded" | "failed" | "stubbed" | "cancelled";

export type VideoJob = {
  jobId: string;
  status: VideoJobStatus;
  modelVersion: string;
  message: string;
  artifactUri?: string;
};

export type VideoConnector = {
  id: string;
  modelVersion: string;
  submit(input: ShotModelInput, signal: AbortSignal): Promise<VideoJob>;
};

const jobSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(["succeeded", "failed", "cancelled", "queued", "running"]),
  modelVersion: z.string().min(1),
  message: z.string().optional(),
  artifactUri: z.string().min(1).optional(),
});

const userMessage = "영상 생성에 실패했습니다.";

const readJob = async (response: Response): Promise<z.infer<typeof jobSchema>> => {
  if (!response.ok) throw new Error(userMessage);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(userMessage);
  }
  const parsed = jobSchema.safeParse(body);
  if (!parsed.success) throw new Error(userMessage);
  if (parsed.data.status === "succeeded" && !parsed.data.artifactUri) throw new Error(userMessage);
  return parsed.data;
};

const settle = async (base: string, job: z.infer<typeof jobSchema>, signal: AbortSignal): Promise<VideoJob> => {
  let current = job;
  for (let attempt = 0; attempt < 30 && (current.status === "queued" || current.status === "running"); attempt += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
    current = await readJob(await fetch(`${base}/jobs/video-render/${encodeURIComponent(current.jobId)}`, { signal }));
  }
  if (current.status === "queued" || current.status === "running") throw new Error(userMessage);
  return {
    jobId: current.jobId,
    status: current.status,
    modelVersion: current.modelVersion,
    message: current.message || userMessage,
    artifactUri: current.artifactUri,
  };
};

const lyraConnector = (baseUrl: string): VideoConnector => ({
  id: "lyra",
  modelVersion: "lyra",
  async submit(input, signal) {
    const payload = parseShotModelInput(input);
    const base = baseUrl.replace(/\/$/, "");
    const created = await readJob(await fetch(`${base}/jobs/video-render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    }));
    return settle(base, created, signal);
  },
});

const stubConnector: VideoConnector = {
  id: "stub",
  modelVersion: "none",
  async submit(input) {
    parseShotModelInput(input);
    return {
      jobId: `stub-${input.recipe.generateHash}-${Date.now()}`,
      status: "stubbed",
      modelVersion: "none",
      message: "연결된 영상 모델이 없어 파일을 만들지 않았습니다.",
    };
  },
};

/** A blank cloud URL is the honest stub. A configured URL never falls back to that stub. */
export const createVideoConnectorFromEnv = ({ lyraCloudUrl }: { lyraCloudUrl?: string }): VideoConnector => {
  const url = lyraCloudUrl?.trim();
  return url ? lyraConnector(url) : stubConnector;
};
