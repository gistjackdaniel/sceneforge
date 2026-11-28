import { eulerToQuaternion } from "../shot/eulerAdapter";
import type { MotionSource, MotionSpan } from "../shot/motionConditions";
import { sampleSubjectPose } from "../shot/queries";
import type { PosedSubject } from "../shot/types";
import { asQuat, asVec3, quatRotate, type Quat, type Vec3 } from "./math";
import { KIMODO_FPS, KIMODO_MAX_FRAMES, KIMODO_MIN_SEGMENT_FRAMES, type SomaGenerationRequest } from "./somaMotion";

/** A prompt over shot frames [startFrame, endFrame). A draft's segments are ordered and back to back. */
export type DraftSegment = { prompt: string; startFrame: number; endFrame: number };
/** A ground point in shot metres that the actor's root reaches at a shot frame. */
export type DraftWaypoint = { frame: number; x: number; z: number };
export type KimodoDraft = { segments: readonly DraftSegment[]; waypoints: readonly DraftWaypoint[] };
/** Where the actor stands when its clip starts. Kimodo clips are placed from their first frame. */
export type ClipPlacement = { position: Vec3; rotation: Quat };

/** Metres per second for timing a new waypoint at a walking pace. */
const WALKING_SPEED = 1.2;

export const emptyDraft = (startFrame: number, endFrame: number): KimodoDraft =>
  ({ segments: [{ prompt: "", startFrame, endFrame }], waypoints: [] });

export const placementAt = (subject: PosedSubject, frame: number): ClipPlacement => {
  const pose = sampleSubjectPose(subject, frame);
  return { position: asVec3(pose.position), rotation: asQuat(eulerToQuaternion(pose.rotationEuler)) };
};

const conjugate = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];

/** A shot ground point in the clip's frame: metres from its first frame, with the actor facing +Z. */
export const toClipGround = (placement: ClipPlacement, x: number, z: number) => {
  const local = quatRotate(conjugate(placement.rotation), [x - placement.position[0], 0, z - placement.position[2]]);
  return { x: local[0], z: local[2] };
};

/** The inverse of toClipGround, as sampleTimelineMotion places a clip whose first heading is zero. */
export const toShotGround = (placement: ClipPlacement, x: number, z: number) => {
  const offset = quatRotate(placement.rotation, [x, 0, z]);
  return { x: placement.position[0] + offset[0], z: placement.position[2] + offset[2] };
};

export const draftWindow = (draft: KimodoDraft) =>
  ({ startFrame: draft.segments[0].startFrame, endFrame: draft.segments[draft.segments.length - 1].endFrame });

/** The Kimodo request for a draft, or the reason it cannot be generated yet. */
export const draftRequest = (draft: KimodoDraft, placement: ClipPlacement, seed = 0):
  { request: SomaGenerationRequest; startFrame: number; endFrame: number } | { blocker: string } => {
  const { startFrame, endFrame } = draftWindow(draft);
  if (draft.segments.some((segment) => !segment.prompt.trim())) return { blocker: "모든 프롬프트 구간에 지시를 입력하세요." };
  if (draft.segments.some((segment) => segment.endFrame - segment.startFrame < KIMODO_MIN_SEGMENT_FRAMES)) {
    return { blocker: "프롬프트 구간은 0.5초 이상이어야 합니다." };
  }
  if (endFrame - startFrame > KIMODO_MAX_FRAMES) return { blocker: "Kimodo는 한 번에 10초까지 생성합니다." };
  const waypoints = draft.waypoints.filter((point) => point.frame > startFrame && point.frame < endFrame);
  return {
    startFrame, endFrame,
    request: {
      segments: draft.segments.map((segment) => ({ prompt: segment.prompt.trim(), frames: segment.endFrame - segment.startFrame })),
      waypoints: waypoints.map((point) => ({ frame: point.frame - startFrame, ...round(toClipGround(placement, point.x, point.z)) })),
      seed,
    },
  };
};

const round = ({ x, z }: { x: number; z: number }) => ({ x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 });

/** The draft that made a span's clip, with its prompts from the span start and its waypoints back on the shot ground. */
export const draftFromSource = (source: MotionSource, span: Pick<MotionSpan, "startFrame" | "endFrame">, placement: ClipPlacement): KimodoDraft => {
  const recipe = source.segments ?? [{ prompt: source.prompt, frames: span.endFrame - span.startFrame }];
  let frame = span.startFrame;
  const segments = recipe.map((segment) => {
    const startFrame = frame;
    frame += segment.frames;
    return { prompt: segment.prompt, startFrame, endFrame: frame };
  });
  segments[segments.length - 1] = { ...segments[segments.length - 1], endFrame: span.endFrame };
  return {
    segments,
    waypoints: (source.waypoints ?? []).map((point) => ({ frame: span.startFrame + point.frame, ...toShotGround(placement, point.x, point.z) })),
  };
};

const withLastEnd = (draft: KimodoDraft, endFrame: number): KimodoDraft => ({
  ...draft,
  segments: draft.segments.map((segment, index) => index === draft.segments.length - 1 ? { ...segment, endFrame } : segment),
});

/**
 * Append a waypoint timed at a walking pace from the previous one, or from the actor when it is the first.
 * The last prompt grows to reach it, within the shot and Kimodo's ten seconds.
 */
export const addWaypoint = (draft: KimodoDraft, placement: ClipPlacement, point: { x: number; z: number }, shotFrames: number): KimodoDraft => {
  const { startFrame, endFrame } = draftWindow(draft);
  const limit = Math.min(shotFrames, startFrame + KIMODO_MAX_FRAMES);
  const previous = draft.waypoints[draft.waypoints.length - 1] ?? { frame: startFrame, x: placement.position[0], z: placement.position[2] };
  const walk = Math.round(Math.hypot(point.x - previous.x, point.z - previous.z) / WALKING_SPEED * KIMODO_FPS);
  const frame = Math.min(previous.frame + Math.max(KIMODO_MIN_SEGMENT_FRAMES, walk), limit - 1);
  if (frame <= previous.frame) return draft;
  const grown = frame >= endFrame - KIMODO_MIN_SEGMENT_FRAMES / 3 ? withLastEnd(draft, Math.min(limit, frame + KIMODO_MIN_SEGMENT_FRAMES)) : draft;
  return { ...grown, waypoints: [...draft.waypoints, { frame, x: point.x, z: point.z }] };
};

export const removeWaypoint = (draft: KimodoDraft, index: number): KimodoDraft =>
  ({ ...draft, waypoints: draft.waypoints.filter((_, at) => at !== index) });

/** Move a waypoint in time, keeping waypoints in order inside the draft. */
export const retimeWaypoint = (draft: KimodoDraft, index: number, frame: number): KimodoDraft => {
  const { startFrame, endFrame } = draftWindow(draft);
  const low = (draft.waypoints[index - 1]?.frame ?? startFrame) + 1;
  const high = (draft.waypoints[index + 1]?.frame ?? endFrame) - 1;
  if (low > high) return draft;
  const clamped = Math.max(low, Math.min(high, Math.round(frame)));
  return { ...draft, waypoints: draft.waypoints.map((point, at) => at === index ? { ...point, frame: clamped } : point) };
};

export const setSegmentPrompt = (draft: KimodoDraft, index: number, prompt: string): KimodoDraft =>
  ({ ...draft, segments: draft.segments.map((segment, at) => at === index ? { ...segment, prompt } : segment) });

/** Add a prompt after the last one, ending at the clicked frame or half a second later, within the shot and ten seconds. */
export const addSegment = (draft: KimodoDraft, endFrame: number, shotFrames: number): KimodoDraft => {
  const { startFrame, endFrame: lastEnd } = draftWindow(draft);
  const limit = Math.min(shotFrames, startFrame + KIMODO_MAX_FRAMES);
  const end = Math.min(limit, Math.max(lastEnd + KIMODO_MIN_SEGMENT_FRAMES, Math.round(endFrame)));
  if (end - lastEnd < KIMODO_MIN_SEGMENT_FRAMES) return draft;
  return { ...draft, segments: [...draft.segments, { prompt: "", startFrame: lastEnd, endFrame: end }] };
};

/**
 * Drag a prompt's right edge. The next prompt starts where this one ends; the last prompt's edge is the clip's end.
 * Every prompt keeps half a second, and the clip stays within the shot and ten seconds.
 */
export const resizeSegment = (draft: KimodoDraft, index: number, endFrame: number, shotFrames: number): KimodoDraft => {
  const segments = draft.segments;
  const low = segments[index].startFrame + KIMODO_MIN_SEGMENT_FRAMES;
  const next = segments[index + 1];
  const high = next ? next.endFrame - KIMODO_MIN_SEGMENT_FRAMES : Math.min(shotFrames, segments[0].startFrame + KIMODO_MAX_FRAMES);
  if (low > high) return draft;
  const end = Math.max(low, Math.min(high, Math.round(endFrame)));
  return {
    ...draft,
    segments: segments.map((segment, at) => at === index ? { ...segment, endFrame: end } : at === index + 1 ? { ...segment, startFrame: end } : segment),
  };
};

/** Remove a prompt; its frames go to the prompt before it, or after it when it is the first. The last prompt stays. */
export const removeSegment = (draft: KimodoDraft, index: number): KimodoDraft => {
  const segments = draft.segments;
  if (segments.length === 1) return draft;
  const kept = segments.filter((_, at) => at !== index);
  const merged = index === 0
    ? kept.map((segment, at) => at === 0 ? { ...segment, startFrame: segments[0].startFrame } : segment)
    : kept.map((segment, at) => at === index - 1 ? { ...segment, endFrame: segments[index].endFrame } : segment);
  return { ...draft, segments: merged };
};

/** Set the clip's first and end frame from the form. Inner prompt boundaries stay where they are. */
export const setDraftWindow = (draft: KimodoDraft, startFrame: number, endFrame: number): KimodoDraft => {
  const segments = draft.segments.map((segment, index) => ({
    ...segment,
    startFrame: index === 0 ? startFrame : segment.startFrame,
    endFrame: index === draft.segments.length - 1 ? endFrame : segment.endFrame,
  }));
  return { ...draft, segments };
};
