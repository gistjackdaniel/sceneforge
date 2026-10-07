import { cameraPathParamsFromNode } from "../domain/graph/cameraPath";
import { cameraPathNodeIdForClip } from "../application/services/viewportCommit";
import { useEditorStore } from "../state/editorStore";

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
          title={cameraKeys === 0 ? "Record a camera trajectory in Motion, then press K." : "Send 3D assets, poses, and the camera trajectory to the video model."}
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
        <span>{cameraKeys === 0 ? "No camera trajectory" : `${cameraKeys} camera keys`}</span>
      </div>
    </header>
  );
};
