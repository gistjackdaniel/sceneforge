export const VIEWPORT_WINDOW_NAME = "sceneforge-viewport";
export const VIEWPORT_WINDOW_CHANNEL = "sceneforge-viewport-window";
export const EDITOR_SYNC_CHANNEL = "sceneforge-editor-sync";

export type ViewportWindowMessage =
  | { type: "opened" }
  | { type: "closed" }
  | { type: "ping" }
  | { type: "reattach" }
  | { type: "focus" };

export const isDetachedViewportWindow = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get("detach") === "viewport";
};

export const detachedViewportUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.set("detach", "viewport");
  return url.toString();
};

export const openDetachedViewportWindow = (): Window | null => {
  const features = [
    "popup=yes",
    "width=1120",
    "height=820",
    "left=96",
    "top=64",
    "menubar=no",
    "toolbar=no",
    "status=no",
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
  return window.open(detachedViewportUrl(), VIEWPORT_WINDOW_NAME, features);
};

export const postViewportWindowMessage = (message: ViewportWindowMessage): void => {
  const channel = new BroadcastChannel(VIEWPORT_WINDOW_CHANNEL);
  channel.postMessage(message);
  channel.close();
};
