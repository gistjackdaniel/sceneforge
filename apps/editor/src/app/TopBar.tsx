import { cameraPathParamsFromNode } from "../domain/graph/cameraPath";
import { cameraPathNodeIdForClip } from "../application/services/viewportCommit";
import { useEditorStore } from "../state/editorStore";

export const TopBar = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const cameraPath = clip
    ? cameraPathParamsFromNode(project.nodes[cameraPathNodeIdForClip(clip)]?.parameters ?? {})
    : undefined;
  const cameraKeys = cameraPath?.keyframes.length ?? 0;
  const activeTake = cameraPath?.takes.find((take) => take.id === cameraPath.activeTakeId);
  const job = ui.videoRenderJob;
  const busy = job?.status === "queued" || job?.status === "running";
  const generate = () => {
    if (clip) dispatch({ type: "submit-video-render", clipId: clip.id });
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
          disabled={!clip || cameraKeys === 0 || busy}
          title={
            cameraKeys === 0
              ? "Record a take or press K in Motion, then Generate."
              : `Send 3D assets, poses, and ${activeTake?.name ?? "the selected take"} to the video model.`
          }
        >
          {busy ? "Generating…" : "Generate video"}
        </button>
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
        <span>
          {cameraKeys === 0
            ? "No camera take"
            : `${activeTake?.name ?? "Take"} · ${cameraKeys} keys`}
        </span>
      </div>
    </header>
  );
};
