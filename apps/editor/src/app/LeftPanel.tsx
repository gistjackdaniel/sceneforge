import { useCallback, type KeyboardEvent } from "react";
import { WorldGenerationPanel } from "../panels/world-generation/WorldGenerationPanel";
import { DirectionPanel } from "../panels/direction/DirectionPanel";
import type { PanelTab } from "../state/editorStore";
import { useEditorStore } from "../state/editorStore";
import { ViewportPane } from "./ViewportPane";

const TABS: Array<{ tab: PanelTab; label: string }> = [
  { tab: "world-generation", label: "World Gen" },
  { tab: "viewport", label: "Viewport" },
  { tab: "direction", label: "Direction" },
];

interface LeftPanelProps {
  expanded: boolean;
  fullscreen: boolean;
  poppedOut: boolean;
  onToggleExpand: () => void;
  onToggleFullscreen: () => void;
  onPopOut: () => void;
  onFocusPopout: () => void;
  onReattach: () => void;
}

export const LeftPanel = ({
  expanded,
  fullscreen,
  poppedOut,
  onToggleExpand,
  onToggleFullscreen,
  onPopOut,
  onFocusPopout,
  onReattach,
}: LeftPanelProps) => {
  const {
    state: {
      ui: { panelTab },
    },
    dispatch,
  } = useEditorStore();

  const selectTab = useCallback(
    (tab: PanelTab) => {
      dispatch({ type: "set-panel-tab", tab });
      if (tab === "viewport" && poppedOut) {
        onFocusPopout();
      }
    },
    [dispatch, onFocusPopout, poppedOut],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.tab === panelTab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = TABS[(index + delta + TABS.length) % TABS.length];
      selectTab(next.tab);
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectTab(TABS[0].tab);
    }
    if (event.key === "End") {
      event.preventDefault();
      selectTab(TABS[TABS.length - 1].tab);
    }
  };

  const expandViewport = () => {
    if (panelTab !== "viewport") {
      selectTab("viewport");
    }
    onToggleExpand();
  };

  const fullscreenViewport = () => {
    if (panelTab !== "viewport") {
      selectTab("viewport");
    }
    onToggleFullscreen();
  };

  return (
    <section className={`left-panel ${panelTab === "viewport" ? "is-showing-viewport" : ""}`}>
      <div className="left-panel-tabs" role="tablist" aria-label="Left panel" onKeyDown={onKeyDown}>
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            id={`left-tab-${item.tab}`}
            aria-selected={panelTab === item.tab}
            aria-controls={`left-panel-${item.tab}`}
            tabIndex={panelTab === item.tab ? 0 : -1}
            className={`left-panel-tab ${panelTab === item.tab ? "is-active" : ""}`}
            onClick={() => selectTab(item.tab)}
          >
            {item.label}
          </button>
        ))}
        <div className="left-panel-tab-actions">
          {!poppedOut && !fullscreen && (
            <button type="button" onClick={expandViewport}>
              {expanded ? "Restore" : "Expand"}
            </button>
          )}
          {!poppedOut && (
            <button type="button" onClick={fullscreenViewport}>
              {fullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
          )}
          {poppedOut ? (
            <>
              <button type="button" onClick={onFocusPopout}>
                Focus window
              </button>
              <button type="button" onClick={onReattach}>
                Reattach
              </button>
            </>
          ) : (
            <button type="button" onClick={onPopOut}>
              Pop out
            </button>
          )}
        </div>
      </div>
      <div
        className="left-panel-body"
        role="tabpanel"
        id={`left-panel-${panelTab}`}
        aria-labelledby={`left-tab-${panelTab}`}
      >
        {panelTab === "world-generation" ? (
          <WorldGenerationPanel />
        ) : panelTab === "direction" ? (
          <DirectionPanel />
        ) : poppedOut ? (
          <div className="viewport-detached-placeholder">
            <p>Viewport is open in a separate window.</p>
            <p className="muted">Move or resize that window like a browser tab you tore off.</p>
            <div className="button-row wrap">
              <button type="button" onClick={onFocusPopout}>
                Focus window
              </button>
              <button type="button" onClick={onReattach}>
                Reattach
              </button>
            </div>
          </div>
        ) : (
          <ViewportPane />
        )}
      </div>
    </section>
  );
};
