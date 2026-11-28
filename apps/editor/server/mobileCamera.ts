import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { mobileCameraSessionSchema, type MobileCameraSession } from "../src/domain/shot/mobileSession";
import { MOBILE_CAMERA_API, MOBILE_TAKE_MAX_BYTES, mobilePairRequestSchema, type MobilePair, type MobilePairSettings } from "../src/domain/shot/mobileCaptureProtocol";
import { createMobileCameraRelay } from "./mobileCameraRelay";

type Pair = {
  code: string;
  editorKey: string;
  settings: MobilePairSettings;
  teardown: AbortController;
  expiration: NodeJS.Timeout;
  take?: MobileCameraSession;
};
const pairRoute = `${MOBILE_CAMERA_API}/pair`;
const takeRoute = `${MOBILE_CAMERA_API}/take`;
const bearer = (request: IncomingMessage) => request.headers.authorization?.match(/^Bearer ([a-f0-9]{32})(?:\.([a-f0-9]{32}))?$/);
const fromLocalEditor = (request: IncomingMessage) => {
  const address = request.socket.remoteAddress;
  return (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1")
    && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? "");
};

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

export const mobileCameraPlugin = (root: string): Plugin => {
  const pairs = new Map<string, Pair>();
  const openRelay = createMobileCameraRelay(root);
  const closePair = (code: string, flushUpload = false) => {
    const pair = pairs.get(code);
    if (!pair) return;
    pairs.delete(code);
    clearTimeout(pair.expiration);
    if (flushUpload && pair.take) setTimeout(() => pair.teardown.abort(), 1000).unref();
    else pair.teardown.abort();
  };
  const closePairs = () => {
    for (const code of pairs.keys()) closePair(code);
  };

  const handlePhone = async (request: IncomingMessage, response: ServerResponse, expectedCode?: string) => {
    const auth = bearer(request);
    const code = auth?.[1];
    const pair = code && !auth?.[2] && (!expectedCode || expectedCode === code) ? pairs.get(code) : undefined;
    if (!pair) return send(response, 404);
    if (request.method === "GET") return send(response, 200, pair.settings);
    if (request.method !== "POST") return send(response, 405);
    if (request.headers["content-type"] !== "application/json") return send(response, 415);
    if (pair.take) return send(response, 204);
    try {
      const parsed = mobileCameraSessionSchema.safeParse(await readJson(request));
      if (!parsed.success) return send(response, 400);
      if (pairs.get(pair.code) !== pair) return send(response, 404);
      pair.take ??= parsed.data;
      return send(response, 204);
    } catch (error) {
      return send(response, error instanceof RangeError ? 413 : 400);
    }
  };

  const createPair = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers["content-type"] !== "application/json") return send(response, 415);
    const parsed = mobilePairRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return send(response, 400);
    if (pairs.size >= 8) return send(response, 429);
    const { transport, ...settings } = parsed.data;
    if (transport === "qr" && !fromLocalEditor(request)) {
      return send(response, 403, { message: "Open the editor on localhost to start QR pairing." });
    }
    const code = randomBytes(16).toString("hex");
    const editorKey = randomBytes(16).toString("hex");
    const teardown = new AbortController();
    const expiration = setTimeout(() => closePair(code), 30 * 60_000).unref();
    const base = { code, editorKey, settings };
    pairs.set(code, { ...base, teardown, expiration });
    const disconnected = () => closePair(code);
    response.once("close", disconnected);
    try {
      const issued: MobilePair = transport === "qr"
        ? { ...base, transport, phoneOrigin: await openRelay((req, res) => void handlePhone(req, res, code), teardown.signal, disconnected) }
        : { ...base, transport };
      teardown.signal.throwIfAborted();
      send(response, 201, issued);
    } catch (error) {
      closePair(code);
      if (!response.destroyed) send(response, 503, { message: error instanceof Error ? error.message : "Couldn't start QR pairing." });
    } finally {
      response.removeListener("close", disconnected);
    }
  };

  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url?.split("?")[0];
    try {
      if (path === takeRoute) return await handlePhone(request, response);
      if (path !== pairRoute) return next();
      if (request.method === "POST") return await createPair(request, response);
      const auth = bearer(request);
      const pair = auth?.[1] ? pairs.get(auth[1]) : undefined;
      if (!pair || auth?.[2] !== pair.editorKey) return send(response, 404);
      if (request.method === "GET") return pair.take ? send(response, 200, pair.take) : send(response, 204);
      if (request.method === "DELETE") {
        closePair(pair.code, true);
        return send(response, 204);
      }
      return send(response, 405);
    } catch (error) {
      return send(response, error instanceof RangeError ? 413 : 400);
    }
  };
  return {
    name: "sceneforge-mobile-camera",
    configureServer: (server) => {
      server.middlewares.use(middleware);
      server.httpServer?.once("close", closePairs);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware);
      server.httpServer.once("close", closePairs);
    },
  };
};
