import { Euler, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { SMPLX_PART_JOINT } from "../worlds/sceneState";
import { GENERATED_MOTION_SOURCE } from "./objectStream";
import { MODEL_FPS, StubMotionModel } from "./motionModel";
import { hashNormalized, stableSerialize } from "./normalizedHash";
import {
  PoseResample,
  QuatMath,
  SMPLX_JOINT_COUNT,
  SMPLX_JOINT_NAMES,
  SmplxSkeleton,
  TwoBoneIk,
  Vec,
  jointIndex,
} from "./pose";

const SHOT_FPS = 16;
const FRAME_COUNT = 128;

describe("SMPL-X pose clock", () => {
  it("names world rig parts with the same SMPL-X joints as SMPLX_PART_JOINT", () => {
    expect(SMPLX_PART_JOINT.left_hand).toBe("left_wrist");
    expect(SMPLX_PART_JOINT.right_hand).toBe("right_wrist");
    for (const joint of Object.values(SMPLX_PART_JOINT)) {
      expect(SMPLX_JOINT_NAMES).toContain(joint);
    }
    expect(jointIndex("left_wrist")).toBe(SmplxSkeleton.limb("left_hand")?.end);
    expect(jointIndex("right_wrist")).toBe(SmplxSkeleton.limb("right_hand")?.end);
  });

  it("resamples model fps 30 onto an 8 second, 16 fps, 128 frame shot", () => {
    expect(SMPLX_JOINT_NAMES).toHaveLength(SMPLX_JOINT_COUNT);
    expect(SmplxSkeleton.restPose([0, 0, 0])).toHaveLength(55);
    const times = PoseResample.modelTimes(SHOT_FPS, FRAME_COUNT, MODEL_FPS);
    expect(StubMotionModel.modelFps).toBe(30);
    expect(times.length).not.toBe(FRAME_COUNT);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo((FRAME_COUNT - 1) / SHOT_FPS, 1);
    const samples = times.map((time) => ({
      time,
      joints: SmplxSkeleton.restPose([time * SHOT_FPS, 0, 0]),
    }));
    const frames = PoseResample.toShotFrames(samples, SHOT_FPS, FRAME_COUNT);
    expect(frames).toHaveLength(FRAME_COUNT);
    expect(frames.map((frame) => frame.frame)).toEqual(Array.from({ length: FRAME_COUNT }, (_, frame) => frame));
    expect(frames.every((frame) => Number.isInteger(frame.frame))).toBe(true);
    expect(frames[0]?.joints[0]?.translation[0]).toBeCloseTo(0, 5);
    expect(frames[64]?.joints[0]?.translation[0]).toBeCloseTo(64, 4);
    expect(frames[127]?.joints[0]?.translation[0]).toBeGreaterThan(126.9);
    expect(frames[127]?.joints[0]?.translation[0]).toBeLessThanOrEqual(127);
  });

  it("matches Three.js Object3D XYZ Euler", () => {
    const euler = new Euler(0.2, 0.4, -0.3, "XYZ");
    const quaternion = new Quaternion().setFromEuler(euler);
    const roundTrip = QuatMath.toEulerXYZ([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
    expect(roundTrip[0]).toBeCloseTo(euler.x, 5);
    expect(roundTrip[1]).toBeCloseTo(euler.y, 5);
    expect(roundTrip[2]).toBeCloseTo(euler.z, 5);
    const yaw = QuatMath.toEulerXYZ(QuatMath.fromYaw(0.4));
    expect(yaw[0]).toBeCloseTo(0, 5);
    expect(yaw[1]).toBeCloseTo(0.4, 5);
    expect(yaw[2]).toBeCloseTo(0, 5);
    const identity = QuatMath.toEulerXYZ(QuatMath.identity());
    expect(identity[0]).toBeCloseTo(0, 6);
    expect(identity[1]).toBeCloseTo(0, 6);
    expect(identity[2]).toBeCloseTo(0, 6);
  });

  it("keeps the chain root still and places the wrist on an in-reach target", () => {
    const pose = SmplxSkeleton.restPose([0, 0.95, 0]);
    const limb = SmplxSkeleton.limb("right_hand");
    expect(limb).toBeDefined();
    if (!limb) return;
    const target = [0.18, 1.39, 0.3] as const;
    const solved = TwoBoneIk.solve(pose, limb, target);
    expect(solved[limb.end]?.translation[0]).toBeCloseTo(target[0], 4);
    expect(solved[limb.end]?.translation[1]).toBeCloseTo(target[1], 4);
    expect(solved[limb.end]?.translation[2]).toBeCloseTo(target[2], 4);
    expect(solved[limb.root]?.translation).toEqual(pose[limb.root]?.translation);
    expect(solved[SmplxSkeleton.pelvisIndex]?.translation).toEqual(pose[SmplxSkeleton.pelvisIndex]?.translation);
    const upper = Vec.length(Vec.sub(solved[limb.mid]!.translation, solved[limb.root]!.translation));
    const lower = Vec.length(Vec.sub(solved[limb.end]!.translation, solved[limb.mid]!.translation));
    expect(upper).toBeCloseTo(0.28, 4);
    expect(lower).toBeCloseTo(0.25, 4);
    expect(jointIndex("right_wrist")).toBe(limb.end);
  });
});

describe("stub motion model", () => {
  const request = {
    shotFps: SHOT_FPS,
    frameCount: FRAME_COUNT,
    actors: [{ actorId: "inst_fixture_actor_a" }, { actorId: "inst_fixture_actor_b" }],
    events: [
      {
        actorId: "inst_fixture_actor_b",
        startFrame: 0,
        endFrame: 127,
        text: "오른손으로 걷는다",
        trajectory: [
          { frame: 0, position: [1, 5, 0.2] as [number, number, number], heading: 0 },
          { frame: 127, position: [1.4, 5, 0.2] as [number, number, number], heading: 0.2 },
        ],
      },
    ],
  };

  it("is deterministic, marks the pose generated, and keeps trajectory height off the pelvis", () => {
    const first = StubMotionModel.infer(request);
    const second = StubMotionModel.infer(request);
    expect(second).toEqual(first);
    const actorB = first[1];
    expect(actorB?.source).toBe(GENERATED_MOTION_SOURCE);
    expect(actorB?.frames).toHaveLength(FRAME_COUNT);
    expect(actorB?.frames[0]?.joints).toHaveLength(55);
    expect(actorB?.frames[0]?.joints[SmplxSkeleton.pelvisIndex]?.translation[0]).toBeCloseTo(1, 5);
    expect(actorB?.frames[0]?.joints[SmplxSkeleton.pelvisIndex]?.translation[1]).toBeCloseTo(0.95, 5);
    expect(actorB?.frames[127]?.joints[SmplxSkeleton.pelvisIndex]?.translation[0]).toBeCloseTo(1.4, 3);
    expect(actorB?.frames[127]?.joints[SmplxSkeleton.pelvisIndex]?.translation[1]).toBeCloseTo(0.95, 5);
  });

  it("lets text move a non-root joint and leaves the pelvis yaw source on the trajectory", () => {
    const quiet = StubMotionModel.infer({ ...request, events: [{ ...request.events[0]!, text: "서 있다" }] });
    const loud = StubMotionModel.infer(request);
    const pelvis = SmplxSkeleton.pelvisIndex;
    expect(loud[1]?.frames[0]?.joints[pelvis]?.rotation).toEqual(quiet[1]?.frames[0]?.joints[pelvis]?.rotation);
    expect(loud[1]?.frames[0]?.joints[3]?.rotation).not.toEqual(quiet[1]?.frames[0]?.joints[3]?.rotation);
  });
});

describe("normalized hash", () => {
  it("matches the graph lane signature and keeps object key order out of the digest", () => {
    expect(stableSerialize({ b: 1, a: [0.1, { d: 1, c: 2 }] })).toBe(stableSerialize({ a: [0.1, { c: 2, d: 1 }], b: 1 }));
    expect(hashNormalized({ b: 1, a: 2 })).toBe(hashNormalized({ a: 2, b: 1 }));
    expect(hashNormalized({ a: 1 })).not.toBe(hashNormalized({ a: 2 }));
    expect(hashNormalized([1, 2])).not.toBe(hashNormalized([2, 1]));
  });
});
