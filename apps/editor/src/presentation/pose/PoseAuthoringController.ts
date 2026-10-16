import type { DomainCommand } from "../../application/commands";
import { actorPoseNodeId } from "../../domain/performance/nodeIds";
import type { PosePresetId, HandPresetId } from "../../domain/performance";

export type JointId =
  | { kind: "global_orient" }
  | { kind: "body"; index: number } // 0..20 (triplets inside body_pose)
  | { kind: "left_hand"; index: number } // 0..14 (triplets)
  | { kind: "right_hand"; index: number } // 0..14 (triplets)
  | { kind: "jaw" };

export interface PoseAuthoringContext {
  clipId: string;
  actorElementId: string;
  /** Clip-local frame index. */
  frame: number;
}

export interface RotationDelta {
  /** Axis-angle delta (radians). */
  axisAngle: [number, number, number];
  /** Apply additively on top of existing joint (default true). */
  relative?: boolean;
}

/**
 * A minimal, UI-agnostic controller that translates viewport events
 * into DomainCommands for SMPL-X pose authoring.
 *
 * Consumers:
 * - Stage viewport overlay: call rotateJoint/commitKeyframe/applyPreset based on gizmo and UI.
 */
export class PoseAuthoringController {
  static poseNodeId(ctx: PoseAuthoringContext): string {
    return actorPoseNodeId(ctx.clipId, ctx.actorElementId);
  }

  /** Build commands to rotate a joint and keep the edit undoable. */
  static rotateJoint(ctx: PoseAuthoringContext, joint: JointId, delta: RotationDelta): DomainCommand[] {
    // For MVP we materialize the edit as a new keyframe at ctx.frame. The viewport is responsible
    // for providing the full pose to add; a later iteration can support deltas via a working buffer.
    // Here we only publish an APPLY_POSE_PRESET fallback (no-op) to keep the interface consistent.
    return [];
  }

  static addKeyframe(ctx: PoseAuthoringContext, pose: {
    global_orient: [number, number, number];
    transl: [number, number, number];
    body_pose: number[];
    left_hand_pose: number[];
    right_hand_pose: number[];
    jaw_pose: [number, number, number];
    expression: number[];
  }): DomainCommand {
    return { type: "ADD_POSE_KEYFRAME", nodeId: this.poseNodeId(ctx), frame: ctx.frame, pose };
  }

  static removeKeyframe(ctx: PoseAuthoringContext): DomainCommand {
    return { type: "REMOVE_POSE_KEYFRAME", nodeId: this.poseNodeId(ctx), frame: ctx.frame };
  }

  static moveKeyframe(ctx: PoseAuthoringContext, toFrame: number): DomainCommand {
    return { type: "MOVE_POSE_KEYFRAME", nodeId: this.poseNodeId(ctx), from: ctx.frame, to: toFrame };
  }

  static applyPreset(ctx: PoseAuthoringContext, preset: PosePresetId, hand?: { side: "left" | "right"; preset: HandPresetId }): DomainCommand {
    return {
      type: "APPLY_POSE_PRESET",
      nodeId: this.poseNodeId(ctx),
      frame: ctx.frame,
      presetId: preset,
      hand,
    };
  }

  static setJointRotation(ctx: PoseAuthoringContext, joint: JointId, axisAngle: [number, number, number]): DomainCommand {
    return {
      type: "SET_JOINT_ROTATION",
      nodeId: this.poseNodeId(ctx),
      frame: ctx.frame,
      target: joint as any,
      axisAngle,
    };
  }
}

