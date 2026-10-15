import { cameraPathParamsFromNode } from "../domain/graph/cameraPath";
import { cameraPathNodeIdForClip } from "../application/services/viewportCommit";
import { useEditorStore } from "../state/editorStore";
import { evaluateShotWorkflow } from "../domain/workflow";

export const TopBar = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const cameraKeys = clip
    ? cameraPathParamsFromNode(project.nodes[cameraPathNodeIdForClip(clip)]?.parameters ?? {}).keyframes.length
    : 0;
  const job = ui.videoRenderJob;
  const busy = job?.status === "queued" || job?.status === "running";
  const readiness = clip
    ? evaluateShotWorkflow({
        clip,
        graph: project.clipGraphs[clip.clipGraphId],
        nodes: project.nodes,
        worlds: project.worlds,
        caches: project.caches,
      })
    : undefined;
  const depHash = clip ? project.dependencyMap.cacheHashesByClipId[clip.id] ?? "no-hash" : "no-clip";
  const duplicateInFlight =
    !!clip &&
    ui.domainJobQueue.jobs.some(
      (j) => (j.status === "queued" || j.status === "running") && j.cacheKey === `final:${clip.id}:${depHash}`,
    );
  const isOutdated =
    !!clip &&
    !!clip.finalCacheId &&
    project.caches[clip.finalCacheId]?.status === "invalid";
  const generate = () => {
    if (!clip || !readiness) return;
    const duration = clip.durationFrames ?? clip.duration ?? 0;
    const size = ui.outputAspect;
    const title = "Render shot?";
    const details = `Duration: ${duration}f · Aspect: ${size} · Quality: final\nEstimated time and cost depend on your backend.`;
    const proceed = window.confirm(
      `${title}\n\n${details}${duplicateInFlight ? "\n\nNote: An identical render is already in flight." : ""}`,
    );
    if (!proceed) return;
    dispatch({
      type: "agent-execute-commands",
      commands: [{ type: "REQUEST_RENDER", clipId: clip.id, quality: "final" }],
      logMessage: "Render requested.",
    });
  };

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <span className="brand-mark">◆</span>
        <strong>SceneForge</strong>
      </div>
      <div className="top-bar-prompt">
        <button
          type="button"
          className="btn-primary"
          onClick={generate}
          disabled={
            !clip ||
            cameraKeys === 0 ||
            busy ||
            (readiness ? !readiness.readyForRender : true) ||
            duplicateInFlight
          }
          title={
            cameraKeys === 0
              ? "Record a camera trajectory in Motion, then press K."
              : readiness && !readiness.readyForRender
              ? readiness.blockingIssues.join(" ")
              : duplicateInFlight
              ? "An identical render is already queued or running."
              : "Send 3D assets, poses, and the camera trajectory to the video model."
          }
        >
          {busy ? "Generating…" : "Generate video"}
        </button>
        {isOutdated && (
          <span className="badge badge-rerender" title="Scene changed since the last render.">
            Outdated
          </span>
        )}
        {job?.message && <span className="muted">{job.message}</span>}
      </div>
      <div className="top-bar-meta">
        <button type="button" onClick={() => dispatch({ type: "undo" })} disabled={ui.commandBus.undoStack.length === 0}>
          Undo
        </button>
        <button type="button" onClick={() => dispatch({ type: "redo" })} disabled={ui.commandBus.redoStack.length === 0}>
          Redo
        </button>
        <span>{clip?.name}</span>
        <span>{cameraKeys === 0 ? "No camera trajectory" : `${cameraKeys} camera keys`}</span>
      </div>
    </header>
  );
};
