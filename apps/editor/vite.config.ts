import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { kimodoMotionPlugin } from "./server/kimodo";
import { photoAvatarPlugin } from "./server/photoAvatar";
import { mobileCameraPlugin } from "./server/mobileCamera";

const editorRoot = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => ({
  plugins: [react(), kimodoMotionPlugin(editorRoot, mode), photoAvatarPlugin(editorRoot, mode), mobileCameraPlugin()],
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
