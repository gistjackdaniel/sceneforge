import { cameraPathParamsFromNode } from "../graph/cameraPath";
import { validateCameraContinuity, type ContinuityActorAnchor } from "../graph/continuity";
import type { NodeBase } from "../graph/types";
import { performancePlanFromNode, performancePlanNodeIdForClip, validatePerformancePlan } from "../performance";
import type { ClipGraph } from "../project/clipGraph";
import type { RenderCacheEntry } from "../rendering/types";
import { clipDurationFrames } from "../timeline/timing";
import type { TimelineClip } from "../timeline/types";
import type { WorldAsset } from "../worlds/types";

export const SHOT_WORKFLOW_STEP_IDS = ["world", "stage", "camera", "performance", "render"] as const;
export type ShotWorkflowStepId = (typeof SHOT_WORKFLOW_STEP_IDS)[number];
export type ShotWorkflowStepState = "done" | "next" | "blocked" | "optional" | "pending";

export interface ShotWorkflowStep {
  id: ShotWorkflowStepId;
  label: string;
  state: ShotWorkflowStepState;
  summary: string;
  detail: string;
  actionLabel: string;
  blockingIssues: string[];
  warnings: string[];
}

export interface ShotWorkflowReadiness {
  steps: ShotWorkflowStep[];
  readyForRender: boolean;
  rendered: boolean;
  nextStepId: ShotWorkflowStepId;
  nextActionLabel: string;
  blockingIssues: string[];
  warnings: string[];
}

export interface ShotWorkflowInput {
  clip: TimelineClip;
  graph?: ClipGraph;
  nodes: Record<string, NodeBase>;
  worlds: Record<string, WorldAsset>;
  caches: Record<string, RenderCacheEntry>;
}

const vectorFromParameter = (value: unknown): [number, number, number] | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number"
    ? [record.x, record.y, record.z]
    : undefined;
};

const actorAnchorsFromGraph = (
  graph: ClipGraph | undefined,
  nodes: Record<string, NodeBase>,
): ContinuityActorAnchor[] =>
  (graph?.nodeIds ?? []).flatMap((nodeId) => {
    const node = nodes[nodeId];
    if (!node || node.kind !== "ActorPlacementNode") {
      return [];
    }
    const position = vectorFromParameter(node.parameters.position);
    if (!position) {
      return [];
    }
    const id =
      typeof node.parameters.worldElementId === "string"
        ? node.parameters.worldElementId
        : typeof node.parameters.mark === "string"
          ? node.parameters.mark
          : node.id;
    return [{ id, label: node.name, position }];
  });

const placementCountFromGraph = (
  graph: ClipGraph | undefined,
  nodes: Record<string, NodeBase>,
): number =>
  (graph?.nodeIds ?? []).filter((nodeId) => {
    const kind = nodes[nodeId]?.kind;
    return kind === "ActorPlacementNode" || kind === "PlacementNode" || kind === "LightingRigNode";
  }).length;

const baseStep = (
  id: ShotWorkflowStepId,
  label: string,
  summary: string,
  detail: string,
  actionLabel: string,
  blockingIssues: string[] = [],
  warnings: string[] = [],
): ShotWorkflowStep => ({
  id,
  label,
  state: blockingIssues.length > 0 ? "blocked" : "done",
  summary,
  detail,
  actionLabel,
  blockingIssues,
  warnings,
});

/**
 * Evaluate the selected clip as a user-facing shot journey rather than as a raw node graph.
 * Only prerequisites that make the render contract invalid are blockers; optional human direction
 * remains visible without preventing the model from handling an ordinary environment shot.
 */
export const evaluateShotWorkflow = (input: ShotWorkflowInput): ShotWorkflowReadiness => {
  const { clip, graph, nodes, worlds, caches } = input;
  const durationFrames = clipDurationFrames(clip);
  const world = clip.linkedWorldId ? worlds[clip.linkedWorldId] : undefined;
  const cameraNodeId = clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
  const cameraParams = cameraPathParamsFromNode(nodes[cameraNodeId]?.parameters ?? {});
  const performanceNodeId = clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
  const performancePlan = performancePlanFromNode(nodes[performanceNodeId]?.parameters);
  const actorAnchors = actorAnchorsFromGraph(graph, nodes);
  const placementCount = placementCountFromGraph(graph, nodes);
  const enabledSources = performancePlan.sources.filter((source) => source.enabled);
  const hasPerformanceIntent =
    enabledSources.length > 0 ||
    performancePlan.cues.length > 0 ||
    Boolean(performancePlan.audioGuide?.uri || performancePlan.audioGuide?.assetId);

  const worldIssues = world ? [] : ["Choose or generate a world for this clip."];
  const worldStep = baseStep(
    "world",
    "World",
    world?.name ?? "No world assigned",
    world
      ? "The clip has a spatial world that can be staged and photographed."
      : "A world is required before camera and staging decisions have stable coordinates.",
    world ? "Review world" : "Choose a world",
    worldIssues,
  );

  const stageIssues: string[] = [];
  const stageWarnings: string[] = [];
  if (hasPerformanceIntent && actorAnchors.length === 0) {
    stageIssues.push("Performance direction exists, but no actor is staged in 3D.");
  } else if (placementCount === 0) {
    stageWarnings.push("No subjects or lights are staged; this will be treated as an environment shot.");
  }
  const stageStep = baseStep(
    "stage",
    "Stage",
    placementCount > 0 ? `${placementCount} staged element(s)` : "Environment-only",
    placementCount > 0
      ? "Static placement provides screen direction, eyelines, and subject-to-camera distance."
      : "Staging is optional for a world-only shot. Add actor placements before authoring performance.",
    placementCount > 0 ? "Review staging" : "Stage subjects",
    stageIssues,
    stageWarnings,
  );
  if (stageIssues.length === 0 && placementCount === 0) {
    stageStep.state = "optional";
  }

  const cameraIssues = cameraParams.keyframes.length > 0
    ? []
    : ["Record at least one camera keyframe."];
  const continuity = validateCameraContinuity(
    cameraParams.keyframes.map((keyframe) => ({ frame: keyframe.frame, position: keyframe.position })),
    actorAnchors,
    cameraParams.continuity,
  );
  const cameraWarnings = continuity.status === "warning" || continuity.status === "invalid"
    ? continuity.issues
    : [];
  const cameraStep = baseStep(
    "camera",
    "Camera",
    cameraParams.keyframes.length > 0
      ? `${cameraParams.keyframes.length} keyframe(s) · ${cameraParams.interpolation}`
      : "No camera recorded",
    cameraParams.keyframes.length > 0
      ? "Framing, lens, camera path, and shot timing are ready for the render contract."
      : "Open Viewport → Record, frame the shot, and press K or Add Keyframe.",
    cameraParams.keyframes.length > 0 ? "Review camera" : "Record camera",
    cameraIssues,
    cameraWarnings,
  );

  const performanceValidation = validatePerformancePlan(
    performancePlan,
    durationFrames,
    actorAnchors.map((actor) => actor.id),
  );
  const performanceIssues = [...performanceValidation.errors];
  const hasDialogue = performancePlan.cues.some((cue) => cue.kind === "dialogue");
  if (hasDialogue && !performancePlan.audioGuide?.uri && !performancePlan.audioGuide?.assetId) {
    performanceIssues.push("Dialogue cues require an edited audio guide for frame-accurate timing.");
  }
  const performanceWarnings = [...performanceValidation.warnings];
  if (actorAnchors.length > 0 && !hasPerformanceIntent) {
    performanceWarnings.push("Actors are staged without external performance direction; the model will improvise generic acting.");
  }
  const performanceStep = baseStep(
    "performance",
    "Performance",
    hasPerformanceIntent
      ? `${enabledSources.length} source(s) · ${performancePlan.cues.length} cue(s)`
      : "Not authored",
    hasPerformanceIntent
      ? "Acting sources, reactions, and edited audio remain independent from rough 3D blocking."
      : actorAnchors.length > 0
        ? "Optional for generic acting, recommended for signature emotion, action, and comedy beats."
        : "No character performance is required for an environment-only shot.",
    hasPerformanceIntent ? "Review direction" : "Add direction",
    performanceIssues,
    performanceWarnings,
  );
  if (performanceIssues.length === 0 && !hasPerformanceIntent) {
    performanceStep.state = "optional";
  }

  const blockingSteps = [worldStep, stageStep, cameraStep, performanceStep].filter(
    (step) => step.blockingIssues.length > 0,
  );
  const readyForRender = blockingSteps.length === 0;
  const finalCache = clip.finalCacheId ? caches[clip.finalCacheId] : undefined;
  const rendered = Boolean(finalCache?.status === "valid" && finalCache.artifactPath);
  const renderStep = baseStep(
    "render",
    "Render",
    rendered
      ? "Final render ready"
      : readyForRender
        ? finalCache?.directionInvalidations?.length
          ? `${finalCache.directionInvalidations.length} channel(s) need re-render`
          : "Ready to render"
        : `${blockingSteps.length} setup step(s) remain`,
    rendered
      ? "Review the generated result and return only to the direction channel that needs revision."
      : readyForRender
        ? "The shot contract is ready for model capability negotiation and rendering."
        : "Resolve the highlighted setup step before submitting the render job.",
    rendered ? "Review render" : readyForRender ? "Render shot" : "Finish setup",
    readyForRender ? [] : blockingSteps.flatMap((step) => step.blockingIssues),
  );
  renderStep.state = rendered ? "done" : readyForRender ? "pending" : "blocked";

  const steps = [worldStep, stageStep, cameraStep, performanceStep, renderStep];
  const firstBlocking = steps.find((step) => step.blockingIssues.length > 0 && step.id !== "render");
  const nextStepId: ShotWorkflowStepId = firstBlocking?.id ?? "render";
  const nextStep = steps.find((step) => step.id === nextStepId) ?? renderStep;
  if (firstBlocking) {
    firstBlocking.state = "next";
  } else if (!rendered) {
    renderStep.state = "next";
  }

  return {
    steps,
    readyForRender,
    rendered,
    nextStepId,
    nextActionLabel: nextStep.actionLabel,
    blockingIssues: blockingSteps.flatMap((step) => step.blockingIssues),
    warnings: steps.flatMap((step) => step.warnings),
  };
};

