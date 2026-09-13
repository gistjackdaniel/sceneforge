import { useCallback, useEffect, useRef, useState } from "react";
import { LeftPanel } from "./LeftPanel";
import { ResizeHandle } from "./ResizeHandle";
import { TopBar } from "./TopBar";
import { ViewportPopoutApp } from "./ViewportPopoutApp";
import {
  isDetachedViewportWindow,
  openDetachedViewportWindow,
  postViewportWindowMessage,
  VIEWPORT_WINDOW_CHANNEL,
  type ViewportWindowMessage,
} from "./viewportWindow";
import { AssistantPanel } from "../panels/chat/AssistantPanel";
import { PlaybackPanel } from "../panels/playback/PlaybackPanel";
import { TimelinePanel } from "../panels/timeline/TimelinePanel";
import { ShotWorkflowBar } from "../panels/workflow/ShotWorkflowBar";
import { InspectorPanel } from "../panels/inspector/InspectorPanel";

const LAYOUT_STORAGE_KEY = "sceneforge-layout-v2";
const POPOUT_SESSION_KEY = "sceneforge-viewport-popout";

type ViewportChrome = "split" | "expanded" | "fullscreen";

interface LayoutSizes {
  leftWidth: number;
  assistantWidth: number;
  timelineHeight: number;
  viewportChrome: ViewportChrome;
}

const DEFAULT_LAYOUT: LayoutSizes = {
  leftWidth: 480,
  assistantWidth: 340,
  timelineHeight: 240,
  viewportChrome: "split",
};

const LIMITS = {
  leftWidth: [300, 900] as const,
  assistantWidth: [260, 560] as const,
  timelineHeight: [140, 480] as const,
};

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, value));

const parseViewportChrome = (value: unknown): ViewportChrome => {
  if (value === "expanded" || value === "fullscreen" || value === "split") {
    return value;
  }
  return DEFAULT_LAYOUT.viewportChrome;
};

const loadLayout = (): LayoutSizes => {
  if (typeof window === "undefined") {
    return DEFAULT_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? window.localStorage.getItem("sceneforge-layout-v1");
    if (!raw) {
      return DEFAULT_LAYOUT;
    }
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>;
    return {
      leftWidth: clamp(Number(parsed.leftWidth ?? DEFAULT_LAYOUT.leftWidth), LIMITS.leftWidth),
      assistantWidth: clamp(
        Number(parsed.assistantWidth ?? DEFAULT_LAYOUT.assistantWidth),
        LIMITS.assistantWidth,
      ),
      timelineHeight: clamp(
        Number(parsed.timelineHeight ?? DEFAULT_LAYOUT.timelineHeight),
        LIMITS.timelineHeight,
      ),
      viewportChrome: parseViewportChrome(parsed.viewportChrome),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
};

const EditorShell = () => {
  const [layout, setLayout] = useState<LayoutSizes>(loadLayout);
  const dragStartRef = useRef<LayoutSizes>(layout);
  const chromeBeforeFullscreenRef = useRef<Exclude<ViewportChrome, "fullscreen">>("split");
  const [poppedOut, setPoppedOut] = useState(() => sessionStorage.getItem(POPOUT_SESSION_KEY) === "1");
  const lastPingRef = useRef(0);
  const poppedOutSinceRef = useRef(Date.now());

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    if (poppedOut) {
      sessionStorage.setItem(POPOUT_SESSION_KEY, "1");
      return;
    }
    sessionStorage.removeItem(POPOUT_SESSION_KEY);
  }, [poppedOut]);

  useEffect(() => {
    const attach = () => {
      setPoppedOut(false);
    };
    const channel = new BroadcastChannel(VIEWPORT_WINDOW_CHANNEL);
    const onMessage = (event: MessageEvent<ViewportWindowMessage>) => {
      if (event.data?.type === "opened" || event.data?.type === "ping") {
        lastPingRef.current = Date.now();
        setPoppedOut(true);
      }
      if (event.data?.type === "closed" || event.data?.type === "reattach") {
        attach();
      }
    };
    channel.addEventListener("message", onMessage);
    const stale = window.setInterval(() => {
      if (!poppedOut) {
        return;
      }
      const now = Date.now();
      if (lastPingRef.current === 0 && now - poppedOutSinceRef.current > 2500) {
        attach();
        return;
      }
      if (lastPingRef.current > 0 && now - lastPingRef.current > 2500) {
        attach();
      }
    }, 800);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
      window.clearInterval(stale);
    };
  }, [poppedOut]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || poppedOut) {
        return;
      }
      if (layout.viewportChrome === "fullscreen") {
        setLayout((current) => ({ ...current, viewportChrome: chromeBeforeFullscreenRef.current }));
        return;
      }
      if (layout.viewportChrome === "expanded") {
        setLayout((current) => ({ ...current, viewportChrome: "split" }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout.viewportChrome, poppedOut]);

  const beginDrag = useCallback(() => {
    dragStartRef.current = layout;
  }, [layout]);

  const resizeLeft = useCallback((delta: number) => {
    setLayout((current) => ({
      ...current,
      leftWidth: clamp(dragStartRef.current.leftWidth + delta, LIMITS.leftWidth),
    }));
  }, []);

  const resizeAssistant = useCallback((delta: number) => {
    setLayout((current) => ({
      ...current,
      assistantWidth: clamp(dragStartRef.current.assistantWidth - delta, LIMITS.assistantWidth),
    }));
  }, []);

  const resizeTimeline = useCallback((delta: number) => {
    setLayout((current) => ({
      ...current,
      timelineHeight: clamp(dragStartRef.current.timelineHeight - delta, LIMITS.timelineHeight),
    }));
  }, []);

  const toggleExpand = useCallback(() => {
    setLayout((current) => ({
      ...current,
      viewportChrome: current.viewportChrome === "expanded" ? "split" : "expanded",
    }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    setLayout((current) => {
      if (current.viewportChrome === "fullscreen") {
        return { ...current, viewportChrome: chromeBeforeFullscreenRef.current };
      }
      chromeBeforeFullscreenRef.current = current.viewportChrome === "expanded" ? "expanded" : "split";
      return { ...current, viewportChrome: "fullscreen" };
    });
  }, []);

  const popOutViewport = useCallback(() => {
    const child = openDetachedViewportWindow();
    if (!child) {
      return;
    }
    lastPingRef.current = Date.now();
    poppedOutSinceRef.current = Date.now();
    setPoppedOut(true);
    setLayout((current) => ({ ...current, viewportChrome: "split" }));
  }, []);

  const focusPopout = useCallback(() => {
    postViewportWindowMessage({ type: "focus" });
  }, []);

  const reattachViewport = useCallback(() => {
    postViewportWindowMessage({ type: "reattach" });
    setPoppedOut(false);
  }, []);

  const expanded = layout.viewportChrome === "expanded" && !poppedOut;
  const fullscreen = layout.viewportChrome === "fullscreen" && !poppedOut;

  return (
    <div className="app-shell">
      <TopBar />
      <ShotWorkflowBar />
      <main
        className={[
          "ide-main",
          expanded ? "is-viewport-expanded" : "",
          fullscreen ? "is-viewport-fullscreen" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          fullscreen
            ? undefined
            : {
                gridTemplateColumns: `${layout.leftWidth}px 6px minmax(0, 1fr) 6px ${layout.assistantWidth}px`,
                gridTemplateRows: `minmax(0, 1fr) 6px ${layout.timelineHeight}px`,
              }
        }
      >
        <LeftPanel
          expanded={expanded}
          fullscreen={fullscreen}
          poppedOut={poppedOut}
          onToggleExpand={toggleExpand}
          onToggleFullscreen={toggleFullscreen}
          onPopOut={popOutViewport}
          onFocusPopout={focusPopout}
          onReattach={reattachViewport}
        />
        <div className="grid-handle-left">
          <ResizeHandle orientation="vertical" onResizeStart={beginDrag} onResize={resizeLeft} />
        </div>
        <PlaybackPanel />
        <div className="grid-handle-assistant">
          <ResizeHandle orientation="vertical" onResizeStart={beginDrag} onResize={resizeAssistant} />
        </div>
        <AssistantPanel />
        {/* Temporary: surface Inspector alongside Assistant to enable approval UI demo */}
        <InspectorPanel />
        <div className="grid-handle-timeline">
          <ResizeHandle orientation="horizontal" onResizeStart={beginDrag} onResize={resizeTimeline} />
        </div>
        <TimelinePanel compact />
      </main>
    </div>
  );
};

export const App = () => (isDetachedViewportWindow() ? <ViewportPopoutApp /> : <EditorShell />);
