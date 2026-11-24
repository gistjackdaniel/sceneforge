import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { mobileCameraSessionSchema, type MobileCameraSession } from "../src/domain/shot/mobileSession";
import { MOBILE_CAMERA_API, MOBILE_TAKE_MAX_BYTES, mobilePairSettingsSchema, type MobilePair } from "../src/domain/shot/mobileCaptureProtocol";

type Pair = MobilePair & { expiresAt: number; take?: MobileCameraSession };

const send = (response: ServerResponse, status: number, body?: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
};

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MOBILE_TAKE_MAX_BYTES) {
      request.resume();
      throw new RangeError("Camera take is too large.");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const mobileCameraPlugin = (): Plugin => {
  const pairs = new Map<string, Pair>();
  const prune = () => {
    for (const [code, pair] of pairs) if (pair.expiresAt <= Date.now()) pairs.delete(code);
  };
  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url?.split("?")[0];
    if (path !== `${MOBILE_CAMERA_API}/pair` && path !== `${MOBILE_CAMERA_API}/take`) return next();
    prune();
    const method = request.method;
    const auth = request.headers.authorization?.match(/^Bearer ([a-f0-9]{32})(?:\.([a-f0-9]{32}))?$/);
    const code = auth?.[1];
    const pair = code ? pairs.get(code) : undefined;
    if (method === "POST" && request.headers["content-type"] !== "application/json") return send(response, 415);
    try {
      if (path.endsWith("/pair") && method === "POST") {
        const parsed = mobilePairSettingsSchema.safeParse(await readJson(request));
        if (!parsed.success) return send(response, 400);
        prune();
        if (pairs.size >= 8) return send(response, 429);
        const pair: MobilePair = {
          code: randomBytes(16).toString("hex"),
          editorKey: randomBytes(16).toString("hex"),
          settings: parsed.data,
        };
        pairs.set(pair.code, { ...pair, expiresAt: Date.now() + 30 * 60_000 });
        return send(response, 201, pair);
      }
      if (!pair) return send(response, 404);
      if (path.endsWith("/take") && method === "GET" && !auth?.[2]) return send(response, 200, pair.settings);
      if (path.endsWith("/take") && method === "POST" && !auth?.[2]) {
        if (pair.take) return send(response, 204);
        const parsed = mobileCameraSessionSchema.safeParse(await readJson(request));
        if (!parsed.success) return send(response, 400);
        prune();
        if (pairs.get(pair.code) !== pair) return send(response, 404);
        pair.take ??= parsed.data;
        return send(response, 204);
      }
      if (auth?.[2] !== pair.editorKey) return send(response, 404);
      if (path.endsWith("/pair") && method === "GET") return pair.take ? send(response, 200, pair.take) : send(response, 204);
      if (path.endsWith("/pair") && method === "DELETE") {
        pairs.delete(pair.code);
        return send(response, 204);
      }
      return send(response, 405);
    } catch (error) {
      return send(response, error instanceof RangeError ? 413 : 400);
    }
  };
  return {
    name: "sceneforge-mobile-camera",
    configureServer: (server) => { server.middlewares.use(middleware); },
    configurePreviewServer: (server) => { server.middlewares.use(middleware); },
  };
};
