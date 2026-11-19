import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { kimodoMotionPlugin } from "./server/kimodo";

export default defineConfig(({ mode }) => ({
  plugins: [react(), kimodoMotionPlugin(fileURLToPath(new URL(".", import.meta.url)), mode)],
  server: {
    port: 4173,
    watch: {
      ignored: ["**/*.glb"],
    },
  },
}));
