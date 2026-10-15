import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(join(__dirname, "../index.html"));
};

app.whenReady().then(() => {
  // Limit permissions: allow audio-only media capture when explicitly requested by the page.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "media") {
      const audio = details.mediaTypes?.includes("audio") ?? false;
      const video = details.mediaTypes?.includes("video") ?? false;
      callback(audio && !video);
      return;
    }
    callback(false);
  });

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
