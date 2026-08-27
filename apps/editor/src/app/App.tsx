import { useCallback, useEffect, useRef, useState } from "react";
import { LeftPanel } from "./LeftPanel";
import { ResizeHandle } from "./ResizeHandle";
import { TopBar } from "./TopBar";
import { AssistantPanel } from "../panels/chat/AssistantPanel";
import { PlaybackPanel } from "../panels/playback/PlaybackPanel";
import { TimelinePanel } from "../panels/timeline/TimelinePanel";

const LAYOUT_STORAGE_KEY = "sceneforge-layout-v1";

interface LayoutSizes {
  leftWidth: number;
  assistantWidth: number;
  timelineHeight: number;
}

const DEFAULT_LAYOUT: LayoutSizes = {
  leftWidth: 480,
  assistantWidth: 340,
  timelineHeight: 240,
};

const LIMITS = {
  leftWidth: [300, 900] as const,
  assistantWidth: [260, 560] as const,
  timelineHeight: [140, 480] as const,
};

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, value));

const loadLayout = (): LayoutSizes => {
  if (typeof window === "undefined") {
    return DEFAULT_LAYOUT;
  }
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
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
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
};

export const App = () => {
  const [layout, setLayout] = useState<LayoutSizes>(loadLayout);
  const dragStartRef = useRef<LayoutSizes>(layout);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

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

  return (
    <div className="app-shell">
      <TopBar />
      <main
        className="ide-main"
        style={{
          gridTemplateColumns: `${layout.leftWidth}px 6px minmax(0, 1fr) 6px ${layout.assistantWidth}px`,
          gridTemplateRows: `minmax(0, 1fr) 6px ${layout.timelineHeight}px`,
        }}
      >
        <LeftPanel />
        <div className="grid-handle-left">
          <ResizeHandle orientation="vertical" onResizeStart={beginDrag} onResize={resizeLeft} />
        </div>
        <PlaybackPanel />
        <div className="grid-handle-assistant">
          <ResizeHandle orientation="vertical" onResizeStart={beginDrag} onResize={resizeAssistant} />
        </div>
        <AssistantPanel />
        <div className="grid-handle-timeline">
          <ResizeHandle orientation="horizontal" onResizeStart={beginDrag} onResize={resizeTimeline} />
        </div>
        <TimelinePanel compact />
      </main>
    </div>
  );
};
