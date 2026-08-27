import {
  clipDurationFrames,
  clipStartFrame,
  type TimelineClip,
} from "../../domain/timeline";
import {
  cancelRenderJob,
  createEmptyJobQueue,
  enqueueRenderJob,
  failRenderJob,
  markRenderJob,
  retryRenderJob,
  type RenderJob,
  type RenderJobQueue,
  renderJobPriority,
} from "../../domain/rendering";

export { createEmptyJobQueue, type RenderJobQueue };

const isNearPlayhead = (clip: TimelineClip, playhead: number): boolean => {
  const start = clipStartFrame(clip);
  const end = start + clipDurationFrames(clip);
  return playhead >= start - 12 && playhead <= end + 12;
};

const isVisible = (clip: TimelineClip, visibleRange: [number, number]): boolean => {
  const start = clipStartFrame(clip);
  const end = start + clipDurationFrames(clip);
  return end >= visibleRange[0] && start <= visibleRange[1];
};

export const enqueueClipRender = (
  queue: RenderJobQueue,
  clip: TimelineClip,
  input: {
    renderNodeId: string;
    quality: RenderJob["quality"];
    cacheKey: string;
    playhead: number;
    visibleRange: [number, number];
    affected?: boolean;
    createdAt: string;
  },
): RenderJobQueue => {
  const job: RenderJob = {
    id: `job-${input.quality}-${clip.id}-${input.createdAt}`,
    clipId: clip.id,
    renderNodeId: input.renderNodeId,
    quality: input.quality,
    priority: renderJobPriority({
      nearPlayhead: isNearPlayhead(clip, input.playhead),
      inVisibleRange: isVisible(clip, input.visibleRange),
      affected: input.affected ?? false,
    }),
    cacheKey: input.cacheKey,
    status: "queued",
    createdAt: input.createdAt,
  };
  return enqueueRenderJob(queue, job);
};

export const requestCancel = (queue: RenderJobQueue, jobId: string, controllers: Map<string, AbortController>) => {
  controllers.get(jobId)?.abort();
  controllers.delete(jobId);
  return cancelRenderJob(queue, jobId);
};

export const requestRetry = retryRenderJob;
export const requestFail = failRenderJob;
export const requestMark = markRenderJob;
