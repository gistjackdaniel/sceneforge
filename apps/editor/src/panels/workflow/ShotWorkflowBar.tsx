import { evaluateShotWorkflow, type ShotWorkflowStepId } from "../../domain/workflow";
import { useEditorStore } from "../../state/editorStore";
import { PendingRerenderBanner } from "./PendingRerenderBanner";

const STEP_INDEX: Record<ShotWorkflowStepId, string> = {
  world: "1",
  stage: "2",
  camera: "3",
  performance: "4",
  render: "5",
};

const STEP_STATE_LABEL = {
  done: "Done",
  next: "Next",
  blocked: "Waiting",
  optional: "Optional",
  pending: "Ready",
} as const;

export const ShotWorkflowBar = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const clip = project.clips[ui.selectedClipId];
  if (!clip) {
    return null;
  }
  const readiness = evaluateShotWorkflow({
    clip,
    graph: project.clipGraphs[clip.clipGraphId],
    nodes: project.nodes,
    worlds: project.worlds,
    caches: project.caches,
  });

  const goToStep = (stepId: ShotWorkflowStepId) => {
    if (stepId === "world") {
      dispatch({ type: "set-panel-tab", tab: "world-generation" });
      return;
    }
    if (stepId === "stage" || stepId === "camera") {
      dispatch({ type: "set-panel-tab", tab: "viewport" });
      dispatch({ type: "set-viewport-workspace", workspace: stepId === "camera" ? "record" : "build" });
      return;
    }
    if (stepId === "performance") {
      dispatch({ type: "set-panel-tab", tab: "direction" });
      return;
    }
    window.requestAnimationFrame(() => {
      const renderButton = document.getElementById("playback-render-button");
      renderButton?.scrollIntoView({ behavior: "smooth", block: "center" });
      renderButton?.focus();
    });
  };

  return (
    <section className="shot-workflow-shell" aria-label="Shot workflow">
      <div className="shot-workflow-bar">
        <div className="shot-workflow-title">
          <span className="eyebrow">Shot workflow</span>
          <strong>{clip.name}</strong>
        </div>
        <ol className="shot-workflow-steps">
          {readiness.steps.map((step) => (
            <li key={step.id} className={`shot-workflow-step is-${step.state}`}>
              <button
                type="button"
                data-workflow-step={step.id}
                aria-current={readiness.nextStepId === step.id ? "step" : undefined}
                title={`${step.detail}${step.warnings.length > 0 ? ` ${step.warnings.join(" ")}` : ""}`}
                onClick={() => goToStep(step.id)}
              >
                <span className="shot-workflow-index">{STEP_INDEX[step.id]}</span>
                <span className="shot-workflow-copy">
                  <span className="shot-workflow-label">{step.label}</span>
                  <span className="shot-workflow-summary">{step.summary}</span>
                </span>
                <span className="shot-workflow-state">{STEP_STATE_LABEL[step.state]}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className={`shot-workflow-next ${readiness.readyForRender ? "is-ready" : ""}`}>
          <span>{readiness.readyForRender ? "Shot contract ready" : `${readiness.blockingIssues.length} blocker(s)`}</span>
          <button type="button" className="btn-primary" onClick={() => goToStep(readiness.nextStepId)}>
            {readiness.nextActionLabel}
          </button>
        </div>
      </div>
      <PendingRerenderBanner />
    </section>
  );
};

