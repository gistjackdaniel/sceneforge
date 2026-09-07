import { useEffect } from "react";
import { ViewportPane } from "./ViewportPane";
import { postViewportWindowMessage, VIEWPORT_WINDOW_CHANNEL } from "./viewportWindow";

export const ViewportPopoutApp = () => {
  useEffect(() => {
    document.title = "SceneForge Viewport";
    postViewportWindowMessage({ type: "opened" });
    const beat = window.setInterval(() => {
      postViewportWindowMessage({ type: "ping" });
    }, 1000);
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "reattach" || event.data?.type === "focus") {
        if (event.data.type === "focus") {
          window.focus();
        }
        if (event.data.type === "reattach") {
          window.close();
        }
      }
    };
    const channel = new BroadcastChannel(VIEWPORT_WINDOW_CHANNEL);
    channel.addEventListener("message", onMessage);
    const onUnload = () => {
      postViewportWindowMessage({ type: "closed" });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.clearInterval(beat);
      channel.removeEventListener("message", onMessage);
      channel.close();
      window.removeEventListener("beforeunload", onUnload);
      postViewportWindowMessage({ type: "closed" });
    };
  }, []);

  const reattach = () => {
    postViewportWindowMessage({ type: "reattach" });
    window.close();
  };

  return (
    <div className="app-shell viewport-popout-shell">
      <header className="viewport-popout-chrome">
        <span className="viewport-pane-title">Viewport</span>
        <button type="button" onClick={reattach}>
          Reattach
        </button>
      </header>
      <ViewportPane alwaysActive />
    </div>
  );
};
