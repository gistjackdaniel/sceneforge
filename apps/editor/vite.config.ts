import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { kimodoMotionPlugin } from "./server/kimodo";
import { photoAvatarPlugin } from "./server/photoAvatar";
import { mobileCameraPlugin } from "./server/mobileCamera";
import { arucoModule } from "./server/arucoModule";

const editorRoot = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => ({
  plugins: [react(), arucoModule(), kimodoMotionPlugin(editorRoot, mode), photoAvatarPlugin(editorRoot, mode), mobileCameraPlugin(editorRoot)],
  optimizeDeps: { exclude: ["js-aruco2"] },
  build: {
    rolldownOptions: {
      input: [fileURLToPath(new URL("index.html", import.meta.url)), fileURLToPath(new URL("mobile-camera.html", import.meta.url))],
    },
  },
  server: {
    port: 4173,
    watch: {
      ignored: ["**/*.glb"],
    },
  },
}));
