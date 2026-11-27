import { describe, expect, it } from "vitest";
import {
  addSegment, addWaypoint, draftFromSource, draftRequest, emptyDraft, removeSegment, resizeSegment, retimeWaypoint,
  setSegmentPrompt, toClipGround, toShotGround, type ClipPlacement, type KimodoDraft,
} from "./kimodoDraft";
import type { MotionSource } from "../shot/motionConditions";
import { quatFromAxisAngle } from "./math";
import { KIMODO_SOMA_MODEL, somaGenerationRequestSchema } from "./somaMotion";

// An actor at (1, 0, 2) turned to face +X.
const facingX: ClipPlacement = { position: [1, 0, 2], rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 2) };
const prompted = (draft: KimodoDraft) => draft.segments.reduce((next, _, index) => setSegmentPrompt(next, index, "A person walks."), draft);

describe("Kimodo draft", () => {
  it("measures waypoints from the actor, in the direction it faces", () => {
    expect(toClipGround(facingX, 3, 2).x).toBeCloseTo(0);
    expect(toClipGround(facingX, 3, 2).z).toBeCloseTo(2);
    const back = toShotGround(facingX, 0.5, 1.5);
    expect(toClipGround(facingX, back.x, back.z).x).toBeCloseTo(0.5);
    expect(toClipGround(facingX, back.x, back.z).z).toBeCloseTo(1.5);
  });

  it("times a clicked point at a walking pace and grows the clip to reach it", () => {
    const draft = addWaypoint(emptyDraft(30, 60), facingX, { x: 3.4, z: 2 }, 120);
    expect(draft.waypoints).toEqual([{ frame: 90, x: 3.4, z: 2 }]);
    expect(draft.segments[draft.segments.length - 1].endFrame).toBe(105);
  });

  it("builds a request in the clip's frame that the generator accepts", () => {
    const draft = prompted(addWaypoint(emptyDraft(30, 60), facingX, { x: 3.4, z: 2 }, 120));
    const built = draftRequest(draft, facingX);
    if ("blocker" in built) throw new Error(built.blocker);
    expect(built).toMatchObject({ startFrame: 30, endFrame: 105 });
    expect(built.request.segments).toEqual([{ prompt: "A person walks.", frames: 75 }]);
    expect(built.request.waypoints).toEqual([{ frame: 60, x: 0, z: 2.4 }]);
    expect(somaGenerationRequestSchema.safeParse(built.request).success).toBe(true);
  });

  it("names what blocks generation", () => {
    expect(draftRequest(emptyDraft(0, 60), facingX)).toEqual({ blocker: "모든 프롬프트 구간에 지시를 입력하세요." });
    expect(draftRequest(prompted(emptyDraft(0, 10)), facingX)).toEqual({ blocker: "프롬프트 구간은 0.5초 이상이어야 합니다." });
    expect(draftRequest(prompted(emptyDraft(0, 301)), facingX)).toEqual({ blocker: "Kimodo는 한 번에 10초까지 생성합니다." });
  });

  it("keeps prompts back to back while they are added, resized, and removed", () => {
    let draft = addSegment(emptyDraft(0, 60), 100, 120);
    expect(draft.segments.map((segment) => [segment.startFrame, segment.endFrame])).toEqual([[0, 60], [60, 100]]);
    draft = resizeSegment(draft, 0, 95, 120);
    expect(draft.segments.map((segment) => [segment.startFrame, segment.endFrame])).toEqual([[0, 85], [85, 100]]);
    draft = removeSegment(draft, 1);
    expect(draft.segments.map((segment) => [segment.startFrame, segment.endFrame])).toEqual([[0, 100]]);
    expect(removeSegment(draft, 0)).toBe(draft);
  });

  it("keeps waypoints in order when one is moved in time", () => {
    const draft: KimodoDraft = { segments: [{ prompt: "", startFrame: 0, endFrame: 120 }], waypoints: [{ frame: 30, x: 0, z: 1 }, { frame: 60, x: 0, z: 2 }] };
    expect(retimeWaypoint(draft, 0, 90).waypoints[0].frame).toBe(59);
    expect(retimeWaypoint(draft, 1, 200).waypoints[1].frame).toBe(119);
  });

  it("restores the draft that made a clip", () => {
    const source: MotionSource = {
      uri: `/api/kimodo/clips/${"a".repeat(64)}.json`, sha256: "a".repeat(64), model: KIMODO_SOMA_MODEL, prompt: "walk · wave", seed: 0, fps: 30,
      frameCount: 90, segments: [{ prompt: "walk", frames: 60 }, { prompt: "wave", frames: 30 }], waypoints: [{ frame: 45, x: 0, z: 2.4 }],
    };
    const draft = draftFromSource(source, { startFrame: 10, endFrame: 100 }, facingX);
    expect(draft.segments).toEqual([{ prompt: "walk", startFrame: 10, endFrame: 70 }, { prompt: "wave", startFrame: 70, endFrame: 100 }]);
    expect(draft.waypoints[0].frame).toBe(55);
    expect(draft.waypoints[0].x).toBeCloseTo(3.4);
    expect(draft.waypoints[0].z).toBeCloseTo(2);
  });
});
