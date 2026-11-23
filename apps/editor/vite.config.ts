import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { kimodoMotionPlugin } from "./server/kimodo";
import { photoAvatarPlugin } from "./server/photoAvatar";

const editorRoot = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => ({
  plugins: [react(), kimodoMotionPlugin(editorRoot, mode), photoAvatarPlugin(editorRoot, mode)],
  server: {
    port: 4173,
    watch: {
      ignored: ["**/*.glb"],
    },
  },
}));
