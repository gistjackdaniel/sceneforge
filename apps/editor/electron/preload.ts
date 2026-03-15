import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("sceneforge", {
  version: "0.1.0",
});
