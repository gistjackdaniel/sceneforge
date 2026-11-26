import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { kimodoMotionPlugin } from "./server/kimodo";
import { photoAvatarPlugin } from "./server/photoAvatar";
import { mobileCameraPlugin } from "./server/mobileCamera";
import { arucoModule } from "./server/arucoModule";
import { PHOTO_ACTOR_ENDPOINT } from "./src/domain/worlds/photoActor";

const editorRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function parseModelServer(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`MODEL_SERVER_URL must be an http or https origin such as http://127.0.0.1:4180, not "${value}".`);
  }
  return url;
}

/** Forward model jobs with the browser's Host, Origin and Sec-Fetch-Site so the remote editor's own checks apply. */
function modelServerProxy(modelServer: URL): Record<string, ProxyOptions> {
  const options: ProxyOptions = {
    target: modelServer.origin,
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on("error", (_error, _request, response) => {
        if (!("req" in response) || response.headersSent || response.writableEnded) return;
        const reply = response as ServerResponse;
        reply.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        reply.end(JSON.stringify({ error: "랩 모델 서버에 연결할 수 없습니다. SSH 터널을 확인하세요." }));
      });
    },
  };
  return { [PHOTO_ACTOR_ENDPOINT]: options, "/api/kimodo/generate": options };
}

export default defineConfig(({ mode }) => {
  const modelServer = parseModelServer(loadEnv(mode, repoRoot, "MODEL_SERVER_").MODEL_SERVER_URL);
  const proxy = modelServer && modelServerProxy(modelServer);
  return {
    plugins: [
      react(), arucoModule(), kimodoMotionPlugin(editorRoot, mode, modelServer),
      ...(modelServer ? [] : [photoAvatarPlugin(editorRoot, mode)]), mobileCameraPlugin(editorRoot),
    ],
    optimizeDeps: { exclude: ["js-aruco2"] },
    build: {
      rolldownOptions: {
        input: [fileURLToPath(new URL("index.html", import.meta.url)), fileURLToPath(new URL("mobile-camera.html", import.meta.url))],
      },
    },
    server: {
      port: 4173,
      proxy,
      watch: {
        ignored: ["**/*.glb"],
      },
    },
    preview: { proxy },
  };
});
