import { LeftPanel } from "./LeftPanel";
import { TopBar } from "./TopBar";
import { ViewportPopoutApp } from "./ViewportPopoutApp";
import { isDetachedViewportWindow } from "./viewportWindow";

const EditorShell = () => (
  <div className="app-shell">
    <TopBar />
    <main className="ide-main is-viewport-fullscreen">
      <LeftPanel
        expanded={false}
        fullscreen
        poppedOut={false}
        onToggleExpand={() => undefined}
        onToggleFullscreen={() => undefined}
        onPopOut={() => undefined}
        onFocusPopout={() => undefined}
        onReattach={() => undefined}
      />
    </main>
  </div>
);

export const App = () => (isDetachedViewportWindow() ? <ViewportPopoutApp /> : <EditorShell />);
