import type { RenderJob, RenderJobStatus, RenderQuality } from "./request";

export interface RenderJobLog {
  at: string;
  jobId: string;
  level: "info" | "warn" | "error";
  message: string;
  retryable?: boolean;
}

export interface RenderJobQueue {
  jobs: RenderJob[];
  logs: RenderJobLog[];
}

export const createEmptyJobQueue = (): RenderJobQueue => ({
  jobs: [],
  logs: [],
});

const log = (
  queue: RenderJobQueue,
  jobId: string,
  level: RenderJobLog["level"],
  message: string,
  retryable?: boolean,
): RenderJobQueue => ({
  ...queue,
  logs: [
    ...queue.logs,
    { at: new Date().toISOString(), jobId, level, message, retryable },
  ],
});

export const enqueueRenderJob = (
  queue: RenderJobQueue,
  job: RenderJob,
): RenderJobQueue => {
  const duplicate = queue.jobs.find(
    (item) =>
      item.clipId === job.clipId &&
      item.quality === job.quality &&
      item.cacheKey === job.cacheKey &&
      (item.status === "queued" || item.status === "running"),
  );
  if (duplicate) {
    return log(queue, duplicate.id, "info", "Skipped duplicate cache-key render request.");
  }
  const jobs = [...queue.jobs, job].sort((a, b) => b.priority - a.priority);
  return log({ ...queue, jobs }, job.id, "info", `Queued ${job.quality} render for ${job.clipId}.`);
};

export const markRenderJob = (
  queue: RenderJobQueue,
  jobId: string,
  status: RenderJobStatus,
  extra?: Partial<RenderJob>,
): RenderJobQueue => ({
  ...queue,
  jobs: queue.jobs.map((job) => (job.id === jobId ? { ...job, ...extra, status } : job)),
});

export const cancelRenderJob = (queue: RenderJobQueue, jobId: string): RenderJobQueue =>
  log(markRenderJob(queue, jobId, "cancelled"), jobId, "warn", "Render cancelled.", false);

export const failRenderJob = (
  queue: RenderJobQueue,
  jobId: string,
  errorMessage: string,
  retryable: boolean,
): RenderJobQueue =>
  log(
    markRenderJob(queue, jobId, "failed", { errorMessage }),
    jobId,
    "error",
    errorMessage,
    retryable,
  );

export const retryRenderJob = (queue: RenderJobQueue, jobId: string): RenderJobQueue => {
  const job = queue.jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "failed") {
    return log(queue, jobId, "warn", "Retry ignored: job is not failed.");
  }
  return log(
    markRenderJob(queue, jobId, "queued", {
      errorMessage: undefined,
      retryCount: (job.retryCount ?? 0) + 1,
    }),
    jobId,
    "info",
    "Retry queued.",
    true,
  );
};

export const qualityLane = (quality: RenderQuality): "proxy" | "final" | "viewport" => {
  if (quality === "final") {
    return "final";
  }
  if (quality === "proxy") {
    return "proxy";
  }
  return "viewport";
};
