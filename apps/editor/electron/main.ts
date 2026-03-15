import { app, BrowserWindow } from "electron";
import { join } from "node:path";

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
    },
  });

  window.loadFile(join(__dirname, "../index.html"));
};

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
