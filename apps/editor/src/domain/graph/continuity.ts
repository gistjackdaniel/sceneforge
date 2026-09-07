import type { CameraContinuityRule } from "./cameraPath";

export interface ContinuityActorAnchor {
  id: string;
  label?: string;
  position: [number, number, number];
}

export interface ContinuityCameraSample {
  frame: number;
  position: [number, number, number];
}

export type ObservedCameraSide = "left" | "right" | "on_axis";

export interface CameraSideSample {
  frame: number;
  side: ObservedCameraSide;
  signedDistance: number;
}

export interface CameraContinuityValidation {
  status: "unconfigured" | "valid" | "warning" | "invalid";
  actorAId?: string;
  actorBId?: string;
  protectedSide: CameraContinuityRule["cameraSide"];
  samples: CameraSideSample[];
  violationFrames: number[];
  issues: string[];
}

const EMPTY_RULE: CameraContinuityRule = {
  lineOfActionLabel: "",
  cameraSide: "unlocked",
  screenDirection: "neutral",
};

/**
 * Validate the 180° line on the ground plane. Left/right is measured while looking
 * from actor A toward actor B; height is intentionally ignored.
 */
export const validateCameraContinuity = (
  cameraSamples: ContinuityCameraSample[],
  actors: ContinuityActorAnchor[],
  rule: CameraContinuityRule | undefined,
): CameraContinuityValidation => {
  const resolvedRule = rule ?? EMPTY_RULE;
  const base = {
    actorAId: resolvedRule.lineActorAId,
    actorBId: resolvedRule.lineActorBId,
    protectedSide: resolvedRule.cameraSide,
    samples: [] as CameraSideSample[],
    violationFrames: [] as number[],
  };
  if (!rule?.lineActorAId || !rule.lineActorBId || rule.lineActorAId === rule.lineActorBId) {
    return {
      ...base,
      status: "unconfigured",
      issues: ["Choose two different actors to define the line of action."],
    };
  }
  const actorA = actors.find((actor) => actor.id === rule.lineActorAId);
  const actorB = actors.find((actor) => actor.id === rule.lineActorBId);
  if (!actorA || !actorB) {
    return {
      ...base,
      status: "unconfigured",
      issues: ["One or both line-of-action actors are missing from the current staging."],
    };
  }
  if (cameraSamples.length === 0) {
    return {
      ...base,
      status: "unconfigured",
      issues: ["Add a camera keyframe to validate the protected side."],
    };
  }

  const axisX = actorB.position[0] - actorA.position[0];
  const axisZ = actorB.position[2] - actorA.position[2];
  const axisLength = Math.hypot(axisX, axisZ);
  if (axisLength < 0.0001) {
    return {
      ...base,
      status: "unconfigured",
      issues: ["The selected actors occupy the same ground-plane position."],
    };
  }

  const samples = cameraSamples.map((camera): CameraSideSample => {
    const cameraX = camera.position[0] - actorA.position[0];
    const cameraZ = camera.position[2] - actorA.position[2];
    const signedDistance = (axisX * cameraZ - axisZ * cameraX) / axisLength;
    const side: ObservedCameraSide =
      Math.abs(signedDistance) < 0.001
        ? "on_axis"
        : signedDistance > 0
          ? "left"
          : "right";
    return { frame: camera.frame, side, signedDistance };
  });
  const violationFrames =
    rule.cameraSide === "unlocked"
      ? []
      : samples
          .filter((sample) => sample.side === "on_axis" || sample.side !== rule.cameraSide)
          .map((sample) => sample.frame);
  const observedSides = new Set(
    samples.filter((sample) => sample.side !== "on_axis").map((sample) => sample.side),
  );
  const issues: string[] = [];
  if (violationFrames.length > 0) {
    issues.push(
      `Camera leaves the protected ${rule.cameraSide} side at ${violationFrames.map((frame) => `${frame}f`).join(", ")}.`,
    );
  } else if (samples.some((sample) => sample.side === "on_axis")) {
    issues.push("A camera keyframe sits directly on the line of action.");
  }
  if (rule.cameraSide === "unlocked" && observedSides.size > 1) {
    issues.push("The camera path crosses the line of action while the side is unlocked.");
  }

  return {
    ...base,
    status:
      violationFrames.length > 0
        ? "invalid"
        : issues.length > 0
          ? "warning"
          : "valid",
    samples,
    violationFrames,
    issues,
  };
};

