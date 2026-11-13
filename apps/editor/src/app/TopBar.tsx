import { hasSelectedTake, selectedTake } from "../domain/shot";
import { useEditorStore } from "../state/editorStore";

export const TopBar = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const shot = project.shots?.[ui.selectedClipId];
  const take = shot ? selectedTake(shot) : undefined;
  const ready = Boolean(shot && hasSelectedTake(shot));
  const job = ui.shotRenderJob;
  const busy = job?.status === "queued" || job?.status === "running";
  const generate = () => {
    if (shot) dispatch({ type: "request-shot-render", shotId: shot.id, outputAspect: ui.outputAspect });
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
          disabled={!ready || busy}
          title={
            ready
              ? `Send 3D assets, poses, and ${take?.name ?? "the selected take"} to the video model.`
              : "Record a take or press K in Motion, then Generate."
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
        <span>{shot?.name}</span>
        <span>
          {take ? `${take.name} · ${take.keys.length} keys` : "No camera take"}
        </span>
      </div>
    </header>
  );
};
