import { generateHash, prepareModelInput, type EnvironmentView, type Shot, type ShotCommand, type ShotRender } from "../../domain/shot";
import { createVideoConnectorFromEnv, type VideoConnector, type VideoJob } from "../../infrastructure/connectors/video/createVideoConnector";

export type ShotRenderJobView = {
  status: "queued" | "running" | "succeeded" | "failed" | "stubbed" | "cancelled";
  message: string;
};

export type ShotRenderListener = {
  onJob: (job: ShotRenderJobView) => void;
  onReceipt: (command: ShotCommand) => void;
};

const receipt = (shot: Shot, connector: VideoConnector, job: VideoJob, now: string): ShotRender => ({
  id: `render-${job.jobId}`,
  jobId: job.jobId,
  connectorId: connector.id,
  modelVersion: job.modelVersion || connector.modelVersion,
  generateHash: generateHash(shot),
  status: job.status,
  artifactUri: job.artifactUri,
  recordedAt: now,
  message: job.message,
});

const failed = (message: string): ShotRenderJobView => ({ status: "failed", message });

/**
 * Builds one model payload, submits it, and records the receipt.
 * A blocker or connector failure does not change the shot subjects or camera.
 */
export const runShotRender = async (args: {
  shot: Shot | undefined;
  environment?: EnvironmentView;
  outputAspect: string;
  connector: VideoConnector;
  signal: AbortSignal;
  now?: string;
  listener: ShotRenderListener;
}): Promise<void> => {
  const shot = args.shot;
  if (!shot) {
    args.listener.onJob(failed("샷을 찾지 못했습니다."));
    return;
  }
  const prepared = prepareModelInput(shot, args.environment, args.outputAspect);
  if (!prepared.ok) {
    args.listener.onJob(failed(prepared.blocker.message));
    return;
  }
  args.listener.onJob({ status: "queued", message: "샷을 영상 모델에 보내는 중…" });
  const stamped = args.now ?? new Date().toISOString();
  try {
    const job = await args.connector.submit(prepared.input, args.signal);
    args.listener.onJob({ status: job.status, message: job.message });
    args.listener.onReceipt({ type: "RECORD_SHOT_RENDER", shotId: shot.id, receipt: receipt(shot, args.connector, job, stamped) });
  } catch (error) {
    const aborted = args.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    if (aborted) {
      const job: VideoJob = { jobId: `cancelled-${prepared.input.recipe.generateHash}`, status: "cancelled", modelVersion: args.connector.modelVersion, message: "영상 생성을 취소했습니다." };
      args.listener.onJob({ status: "cancelled", message: job.message });
      args.listener.onReceipt({ type: "RECORD_SHOT_RENDER", shotId: shot.id, receipt: receipt(shot, args.connector, job, stamped) });
      return;
    }
    args.listener.onJob(failed("영상 생성에 실패했습니다."));
    args.listener.onReceipt({
      type: "RECORD_SHOT_RENDER",
      shotId: shot.id,
      receipt: receipt(shot, args.connector, {
        jobId: `failed-${prepared.input.recipe.generateHash}-${stamped}`,
        status: "failed",
        modelVersion: args.connector.modelVersion,
        message: "영상 생성에 실패했습니다.",
      }, stamped),
    });
  }
};

export const startShotRender = (args: Omit<Parameters<typeof runShotRender>[0], "connector"> & { lyraCloudUrl?: string }) =>
  runShotRender({
    ...args,
    connector: createVideoConnectorFromEnv({ lyraCloudUrl: args.lyraCloudUrl }),
  });
