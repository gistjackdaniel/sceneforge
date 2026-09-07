import type { NodeBase } from "../graph/types";
import { clipDurationFrames } from "./timing";
import type { TimelineClip } from "./types";

export interface TemporalRange {
  startFrame: number;
  endFrame: number;
}

export interface TemporalValidationResult {
  ok: boolean;
  issues: string[];
}

const TEMPORAL_KINDS = new Set([
  "CameraPathNode",
  "ActionBlockNode",
  "ObjectTrajectoryNode",
  "PerformancePlanNode",
]);

export const nodeTemporalRange = (node: NodeBase): TemporalRange | undefined => {
  if (!TEMPORAL_KINDS.has(node.kind)) {
    return undefined;
  }
  const params = node.parameters ?? {};
  const cues = params.cues as Array<{ startFrame?: number; endFrame?: number }> | undefined;
  if (node.kind === "PerformancePlanNode" && Array.isArray(cues) && cues.length > 0) {
    const starts = cues.map((item) => Number(item.startFrame ?? 0));
    const ends = cues.map((item) => Number(item.endFrame ?? item.startFrame ?? 0));
    return { startFrame: Math.min(...starts), endFrame: Math.max(...ends) };
  }
  const keyframes = params.keyframes as Array<{ frame?: number }> | undefined;
  if (Array.isArray(keyframes) && keyframes.length > 0) {
    const frames = keyframes.map((item) => item.frame ?? 0);
    return { startFrame: Math.min(...frames), endFrame: Math.max(...frames) };
  }
  const frameCount = Number(params.frameCount ?? params.durationFrames ?? 0);
  if (frameCount > 0) {
    return { startFrame: 0, endFrame: frameCount };
  }
  return undefined;
};

/**
 * Clip duration must cover camera, blocking, and performance timing ranges (PRD §10.3).
 */
export const validateClipTemporalNodes = (
  clip: TimelineClip,
  nodes: Record<string, NodeBase>,
  nodeIds: string[],
): TemporalValidationResult => {
  const duration = clipDurationFrames(clip);
  const issues: string[] = [];
  nodeIds.forEach((nodeId) => {
    const node = nodes[nodeId];
    if (!node) {
      return;
    }
    const range = nodeTemporalRange(node);
    if (!range) {
      return;
    }
    if (range.endFrame > duration) {
      issues.push(
        `${node.name} 시간 범위(${range.endFrame}f)가 클립 길이(${duration}f)를 초과합니다.`,
      );
    }
    if (range.startFrame < 0) {
      issues.push(`${node.name} 시작 프레임이 0보다 작습니다.`);
    }
  });
  return { ok: issues.length === 0, issues };
};
