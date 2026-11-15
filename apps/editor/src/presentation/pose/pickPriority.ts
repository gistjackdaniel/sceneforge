export type PosePickWorkspace = "build" | "record";
export type PosePickTool = "navigate" | "select" | "translate" | "rotate" | "scale" | "camera";
export type PosePickWinner = "camera-gizmo" | "joint" | "object";

export interface PosePickDistances {
  cameraGizmoDistance?: number;
  jointDistance?: number;
  objectDistance?: number;
  workspace: PosePickWorkspace;
  tool: PosePickTool;
}

const TIE_RANK: Record<PosePickWinner, number> = {
  "camera-gizmo": 0,
  joint: 1,
  object: 2,
};

/**
 * Pointer winner for the stage viewport.
 * The #16 camera gizmo wins on overlap (closer, or tied).
 * Joint helpers win over scene objects only in build, and never while
 * navigating, recording, or using the camera tool. Record-mode keyboard
 * rotation is outside this pick path.
 */
export class JointPickPriority {
  static winner(input: PosePickDistances): PosePickWinner | undefined {
    if (input.workspace !== "build" || input.tool === "navigate") {
      return undefined;
    }
    const candidates: Array<{ kind: PosePickWinner; distance: number }> = [];
    if (typeof input.cameraGizmoDistance === "number") {
      candidates.push({ kind: "camera-gizmo", distance: input.cameraGizmoDistance });
    }
    if (input.tool !== "camera" && typeof input.jointDistance === "number") {
      candidates.push({ kind: "joint", distance: input.jointDistance });
    }
    if (typeof input.objectDistance === "number") {
      candidates.push({ kind: "object", distance: input.objectDistance });
    }
    candidates.sort((a, b) => a.distance - b.distance || TIE_RANK[a.kind] - TIE_RANK[b.kind]);
    return candidates[0]?.kind;
  }

  static readJointTarget(value: unknown):
    | { kind: "global_orient" }
    | { kind: "jaw" }
    | { kind: "body"; index: number }
    | { kind: "left_hand"; index: number }
    | { kind: "right_hand"; index: number }
    | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const kind = record.kind;
    if (kind === "global_orient" || kind === "jaw") {
      return { kind };
    }
    if ((kind === "body" || kind === "left_hand" || kind === "right_hand") && typeof record.index === "number" && Number.isInteger(record.index) && record.index >= 0) {
      return { kind, index: record.index };
    }
    return undefined;
  }
}

export const shouldPrioritizeJointPick = (input: {
  jointPicked: boolean;
  workspace: PosePickWorkspace;
  tool: PosePickTool;
  cameraGizmoPicked?: boolean;
}): boolean => {
  if (!input.jointPicked) {
    return false;
  }
  return JointPickPriority.winner({
    cameraGizmoDistance: input.cameraGizmoPicked ? 0 : undefined,
    jointDistance: input.cameraGizmoPicked ? 1 : 0,
    workspace: input.workspace,
    tool: input.tool,
  }) === "joint";
};
