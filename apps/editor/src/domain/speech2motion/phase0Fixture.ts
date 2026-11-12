import { QuatMath, Vec, type Quat, type Vec3 } from "./pose";
import { multiplyMat4, worldTransform, type Mat4 } from "./objectStream";

/**
 * Phase 0 fixture constants from World PR #36 (`phase0Sample.ts`).
 *
 * TODO(#36 머지 후 교체): import `phase0LeftHandWorldPose`, `PHASE0_TABLE_POSITION`,
 * `PHASE0_ACTOR_A_ROOT`, `PHASE0_ACTOR_B_ROOT`, and `PHASE0_CUP_IN_HAND_OFFSET`
 * from `domain/shot/phase0Sample.ts`. Do not import that module while #36 is off this base.
 * TODO(#36 머지 후 교체): sparse keys come from `bakeDenseObjectMotion`
 * (`domain/shot/motionBake.ts`). Tolerances there are 5 mm, 2°, and scale 1e-4.
 * This lane still emits dense `T_world_obj` and does not bake.
 * TODO(#36 머지 후 교체): `generated` is on `PERFORMANCE_SOURCE_TYPES` in
 * `domain/performance/plan.ts`. Keep `GENERATED_MOTION_SOURCE` until that file is on this base.
 */

export const PHASE0_TABLE_POSITION: Vec3 = [1.25, 0.72, 0.1];
export const PHASE0_ACTOR_A_ROOT: Vec3 = [1.001, 0.38, -0.309];
export const PHASE0_ACTOR_B_ROOT: Vec3 = [2.001, 0.38, -0.309];

/** Wrist-to-cup offset in the `left_hand` frame. Not a world position. */
export const PHASE0_CUP_IN_HAND_OFFSET: Vec3 = [0.03, 0.02, 0.05];

/**
 * #36 places the cup origin on the tabletop, so no extra half-height is added.
 * The on-table height is `0.72 + PHASE0_CUP_HALF_HEIGHT_M`.
 */
export const PHASE0_CUP_HALF_HEIGHT_M = 0;

export const PHASE0_STUB_ARM_LENGTH_M = 0.53;
export const PHASE0_LEFT_SHOULDER_IN_ROOT: Vec3 = [-0.18, 0.4, 0.02];

/** Same contact gap `bakeDenseObjectMotion` uses for position. */
export const PHASE0_CONTACT_TOLERANCE_M = 0.005;

const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

const shoulderWorld = (): Vec3 => Vec.add(PHASE0_ACTOR_A_ROOT, PHASE0_LEFT_SHOULDER_IN_ROOT);

const handOnTable = (): Vec3 => Vec.sub(PHASE0_TABLE_POSITION, PHASE0_CUP_IN_HAND_OFFSET);

const handAtStart = (): Vec3 => {
  const towardChest: Vec3 = [-0.08, -0.16, 0.22];
  return Vec.add(shoulderWorld(), Vec.scale(towardChest, 0.28 / Vec.length(towardChest)));
};

/**
 * Actor A's `left_hand` world pose while the cup is in that hand.
 * Frame 48 is the release. The wrist stays inside the 0.53 m stub arm.
 * Local copy of #36 `phase0LeftHandWorldPose`.
 */
export const phase0LeftHandWorldPose = (frame: number): { translation: Vec3; rotation: Quat } => {
  const amount = Math.min(1, Math.max(0, frame / 48));
  const start = handAtStart();
  const end = handOnTable();
  return {
    translation: Vec.add(start, Vec.scale(Vec.sub(end, start), amount)),
    rotation: IDENTITY_QUAT,
  };
};

/** `T_world_obj` = parent world pose × local offset. Identity rotation keeps the multiply a translation. */
export const composeWorldPose = (parentTranslation: Vec3, parentRotation: Quat, localOffset: Vec3): Mat4 =>
  multiplyMat4(worldTransform(parentTranslation, parentRotation), worldTransform(localOffset, QuatMath.identity()));

/** Cup origin on the tabletop. Y is `0.72 +` the fixture half-height. */
export const phase0CupOnTable = (): Vec3 => [
  PHASE0_TABLE_POSITION[0],
  PHASE0_TABLE_POSITION[1] + PHASE0_CUP_HALF_HEIGHT_M,
  PHASE0_TABLE_POSITION[2],
];
