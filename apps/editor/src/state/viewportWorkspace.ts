export type ViewportWorkspace = "build" | "record";

/** Build places assets/lights/cameras; Record is first-person capture at output aspect. */
export const parseViewportWorkspace = (ui: {
  viewportWorkspace?: unknown;
  shotCameraActive?: unknown;
}): ViewportWorkspace => {
  if (ui.viewportWorkspace === "build" || ui.viewportWorkspace === "record") {
    return ui.viewportWorkspace;
  }
  return ui.shotCameraActive === true ? "record" : "build";
};
