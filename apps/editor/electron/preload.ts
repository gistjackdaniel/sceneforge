import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("sceneforge", {
  version: "0.1.0",
  voice: {
    // Curated surface; actual adapters live in renderer. This flag helps UIs choose typed-text fallback.
    microphoneAvailable: typeof navigator !== "undefined" && "mediaDevices" in navigator,
  },
});
