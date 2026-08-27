import type { TimelineClip } from "../project/types";

export type RenderQueueKind = "proxy" | "final";

export type RenderQueueItemStatus = "queued" | "rendering" | "done" | "failed";

export interface RenderQueueItem {
  id: string;
  clipId: string;
  kind: RenderQueueKind;
  priority: number;
  triggeredByNodeId?: string;
  status: RenderQueueItemStatus;
  enqueuedAt: string;
}

export interface RenderQueueState {
  proxy: RenderQueueItem[];
  final: RenderQueueItem[];
}

const emptyQueue = (): RenderQueueState => ({ proxy: [], final: [] });

/** Higher priority renders first: playhead proximity > visible range > affected > background. */
export const computeRenderPriority = (
  clip: TimelineClip,
  playhead: number,
  visibleRange: [number, number],
): number => {
  const distance = Math.abs(clip.start + clip.duration / 2 - playhead);
  const inVisible =
    clip.end >= visibleRange[0] && clip.start <= visibleRange[1] ? 1000 : 0;
  const playheadBoost = Math.max(0, 500 - distance);
  return inVisible + playheadBoost;
};

export const enqueueAffectedClips = (
  queue: RenderQueueState,
  clipIds: string[],
  kind: RenderQueueKind,
  playhead: number,
  visibleRange: [number, number],
  clips: Record<string, TimelineClip>,
  triggeredByNodeId?: string,
  enqueuedAt?: string,
): RenderQueueState => {
  const timestamp = enqueuedAt ?? new Date().toISOString();
  const next = { ...queue, [kind]: [...queue[kind]] };

  clipIds.forEach((clipId) => {
    const clip = clips[clipId];
    if (!clip) {
      return;
    }
    const exists = next[kind].some(
      (item) => item.clipId === clipId && (item.status === "queued" || item.status === "rendering"),
    );
    if (exists) {
      return;
    }
    next[kind].push({
      id: `queue-${kind}-${clipId}-${Date.now()}`,
      clipId,
      kind,
      priority: computeRenderPriority(clip, playhead, visibleRange),
      triggeredByNodeId,
      status: "queued",
      enqueuedAt: timestamp,
    });
  });

  next[kind].sort((left, right) => right.priority - left.priority);
  return next;
};

export const dequeueNext = (
  queue: RenderQueueState,
  kind: RenderQueueKind,
): { item: RenderQueueItem | undefined; queue: RenderQueueState } => {
  const items = queue[kind];
  const index = items.findIndex((item) => item.status === "queued");
  if (index === -1) {
    return { item: undefined, queue };
  }
  const item = { ...items[index], status: "rendering" as const };
  const nextItems = [...items];
  nextItems[index] = item;
  return { item, queue: { ...queue, [kind]: nextItems } };
};

export const markQueueItem = (
  queue: RenderQueueState,
  itemId: string,
  status: RenderQueueItemStatus,
): RenderQueueState => {
  const updateLane = (lane: RenderQueueItem[]) =>
    lane.map((item) => (item.id === itemId ? { ...item, status } : item));

  return {
    proxy: updateLane(queue.proxy),
    final: updateLane(queue.final),
  };
};

export const createEmptyRenderQueue = (): RenderQueueState => emptyQueue();

export const queueLength = (queue: RenderQueueState): number =>
  queue.proxy.filter((item) => item.status === "queued" || item.status === "rendering").length +
  queue.final.filter((item) => item.status === "queued" || item.status === "rendering").length;
