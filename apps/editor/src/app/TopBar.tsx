import { useEditorStore } from "../state/editorStore";

export const TopBar = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const activeSequence = project.sequences[project.activeSequenceId];
  const selectedClip = project.clips[ui.selectedClipId];

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <span className="brand-mark">◆</span>
        <div>
          <strong>SceneForge</strong>
          <nav className="top-nav">
            <button type="button" className="nav-link is-active">
              Editor
            </button>
            <button type="button" className="nav-link">
              Library
            </button>
            <button type="button" className="nav-link">
              Assets
            </button>
            <button type="button" className="nav-link">
              Render
            </button>
          </nav>
        </div>
      </div>

      <div className="top-bar-prompt">
        <input
          className="prompt-input"
          placeholder="Enter cinematic prompt..."
          value={ui.worldGenDraft.prompt}
          onChange={(event) =>
            dispatch({
              type: "set-world-gen-draft",
              draft: { prompt: event.target.value },
            })
          }
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => dispatch({ type: "set-panel-tab", tab: "world-generation" })}
        >
          Generate World
        </button>
      </div>

      <div className="top-bar-meta">
        <button
          type="button"
          onClick={() => dispatch({ type: "undo" })}
          disabled={ui.commandBus.undoStack.length === 0}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "redo" })}
          disabled={ui.commandBus.redoStack.length === 0}
        >
          Redo
        </button>
        <span>{activeSequence.name}</span>
        <span>{selectedClip.name}</span>
        <span>{ui.playback}</span>
      </div>
    </header>
  );
};
