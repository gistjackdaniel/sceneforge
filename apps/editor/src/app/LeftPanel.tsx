import { StagePanel } from "../panels/stage/StagePanel";
import { WorldGenerationPanel } from "../panels/world-generation/WorldGenerationPanel";
import type { PanelTab } from "../state/editorStore";
import { useEditorStore } from "../state/editorStore";

const TABS: Array<{ tab: PanelTab; label: string }> = [
  { tab: "viewport", label: "Viewport" },
  { tab: "world-generation", label: "World Gen" },
];

export const LeftPanel = () => {
  const {
    state: {
      ui: { panelTab },
    },
    dispatch,
  } = useEditorStore();

  return (
    <section className="left-panel">
      <div className="left-panel-tabs">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            className={`left-panel-tab ${panelTab === item.tab ? "is-active" : ""}`}
            onClick={() => dispatch({ type: "set-panel-tab", tab: item.tab })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="left-panel-body">
        {panelTab === "world-generation" ? <WorldGenerationPanel /> : <StagePanel compact />}
      </div>
    </section>
  );
};
