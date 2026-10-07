import { ViewportPane } from "./ViewportPane";

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

export const LeftPanel = (_props: LeftPanelProps) => (
  <section className="left-panel is-showing-viewport" aria-label="Scene">
    <div className="left-panel-body">
      <ViewportPane />
    </div>
  </section>
);
