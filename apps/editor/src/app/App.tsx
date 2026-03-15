import { ChatPanel } from "../panels/chat/ChatPanel";
import { GraphPanel } from "../panels/graph/GraphPanel";
import { InspectorPanel } from "../panels/inspector/InspectorPanel";
import { LibraryPanel } from "../panels/library/LibraryPanel";
import { StagePanel } from "../panels/stage/StagePanel";
import { TimelinePanel } from "../panels/timeline/TimelinePanel";
import { useEditorStore } from "../state/editorStore";

const SidePanel = () => {
  const {
    state: {
      ui: { panelTab },
    },
    dispatch,
  } = useEditorStore();

  return (
    <aside className="side-panel panel">
      <div className="panel-tabs">
        <button
          className={panelTab === "inspector" ? "is-active" : ""}
          onClick={() => dispatch({ type: "set-panel-tab", tab: "inspector" })}
        >
          Inspector
        </button>
        <button
          className={panelTab === "library" ? "is-active" : ""}
          onClick={() => dispatch({ type: "set-panel-tab", tab: "library" })}
        >
          Library
        </button>
        <button
          className={panelTab === "chat" ? "is-active" : ""}
          onClick={() => dispatch({ type: "set-panel-tab", tab: "chat" })}
        >
          Chat
        </button>
      </div>
      <div className="side-panel-content">
        {panelTab === "inspector" && <InspectorPanel />}
        {panelTab === "library" && <LibraryPanel />}
        {panelTab === "chat" && <ChatPanel />}
      </div>
    </aside>
  );
};

export const App = () => {
  const {
    state: { project, ui },
  } = useEditorStore();
  const activeSequence = project.sequences[project.activeSequenceId];
  const selectedClip = project.clips[ui.selectedClipId];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Timeline-first modular editor</p>
          <h1>SceneForge Editor</h1>
        </div>
        <div className="header-stats">
          <span>Sequence: {activeSequence.name}</span>
          <span>Selected Clip: {selectedClip.name}</span>
          <span>Playback: {ui.playback}</span>
          <span>Cache Hit Rate: {(project.metrics.cacheHitRate * 100).toFixed(0)}%</span>
        </div>
      </header>

      <main className="app-main">
        <section className="workspace">
          <div className="workspace-top">
            <StagePanel />
            <SidePanel />
          </div>
          <div className="workspace-middle">
            <GraphPanel />
          </div>
          <div className="workspace-bottom">
            <TimelinePanel />
          </div>
        </section>
      </main>
    </div>
  );
};
