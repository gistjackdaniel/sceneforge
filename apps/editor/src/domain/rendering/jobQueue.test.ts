import { describe, expect, it } from "vitest";
import {
  cancelRenderJob,
  createEmptyJobQueue,
  enqueueRenderJob,
  retryRenderJob,
  failRenderJob,
} from "./jobQueue";
import { layersInvalidatedByChange } from "./invalidationTable";
import { normalizeRenderRequest, renderJobPriority, validateRenderRequest } from "./request";
import type { RenderJob } from "./request";

const job = (overrides: Partial<RenderJob> = {}): RenderJob => ({
  id: "job-1",
  clipId: "clip-a",
  renderNodeId: "render",
  quality: "proxy",
  priority: 2000,
  cacheKey: "ck-aaa",
  status: "queued",
  createdAt: "t",
  ...overrides,
});

describe("render request", () => {
  it("normalizes defaults and validates", () => {
    const request = normalizeRenderRequest({ task: "image_to_world", conditions: [] });
    expect(request.fps).toBe(24);
    expect(validateRenderRequest(request).ok).toBe(true);
  });
});

describe("job queue", () => {
  it("skips duplicate cache keys and supports cancel + retry", () => {
    let queue = enqueueRenderJob(createEmptyJobQueue(), job());
    queue = enqueueRenderJob(queue, job({ id: "job-2" }));
    expect(queue.jobs).toHaveLength(1);

    queue = failRenderJob(queue, "job-1", "connector timeout", true);
    expect(queue.jobs[0].status).toBe("failed");
    queue = retryRenderJob(queue, "job-1");
    expect(queue.jobs[0].status).toBe("queued");
    expect(queue.jobs[0].retryCount).toBe(1);

    queue = cancelRenderJob(queue, "job-1");
    expect(queue.jobs[0].status).toBe("cancelled");
  });

  it("orders playhead jobs above background", () => {
    expect(renderJobPriority({ nearPlayhead: true, inVisibleRange: true, affected: true })).toBeGreaterThan(
      renderJobPriority({ nearPlayhead: false, inVisibleRange: false, affected: true }),
    );
  });
});

describe("invalidation table §11.5", () => {
  it("does not invalidate caches for UI position or display name", () => {
    expect(layersInvalidatedByChange("node_ui_position")).toEqual([]);
    expect(layersInvalidatedByChange("node_display_name")).toEqual([]);
  });

  it("invalidates proxy/final for camera and duration changes", () => {
    expect(layersInvalidatedByChange("camera_transform")).toContain("proxy");
    expect(layersInvalidatedByChange("clip_duration")).toContain("final");
    expect(layersInvalidatedByChange("clip_start")).toEqual([]);
  });
});
