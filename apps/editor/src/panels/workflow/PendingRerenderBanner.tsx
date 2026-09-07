import { useEditorStore } from "../../state/editorStore";

export const PendingRerenderBanner = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const pending = ui.pendingRerender;
  if (!pending) {
    return null;
  }

  const clipNames = pending.affectedClipIds
    .map((clipId) => project.clips[clipId]?.name ?? clipId)
    .join(", ");

  return (
    <div className="pending-rerender-strip" role="status">
      <div className="pending-rerender-copy">
        <strong>Approve partial rerender</strong>
        <span>
          {pending.impactSentence} {pending.affectedClipIds.length} clip(s): {clipNames}.
        </span>
      </div>
      <div className="button-row wrap">
        <button type="button" className="btn-primary" onClick={() => dispatch({ type: "approve-partial-rerender" })}>
          Approve ({pending.affectedClipIds.length})
        </button>
        <button type="button" onClick={() => dispatch({ type: "dismiss-partial-rerender" })}>
          Later
        </button>
      </div>
    </div>
  );
};
