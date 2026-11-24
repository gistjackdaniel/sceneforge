import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { PHOTO_ACTOR_ENDPOINT, PHOTO_ACTOR_MAX_IMAGE_BYTES, isPhotoActorImageMime, type PhotoActorImageMime } from "../src/domain/worlds/photoActor";
import { photoAvatarProvider } from "./photoAvatarProvider";

function reply(response: ServerResponse, code: number, body: object): void {
  if (response.destroyed) return;
  response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readPhoto(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > PHOTO_ACTOR_MAX_IMAGE_BYTES) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function matchesImage(bytes: Buffer, mime: PhotoActorImageMime): boolean {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

export function photoAvatarPlugin(editorRoot: string, mode: string): Plugin {
  const config = loadEnv(mode, resolve(editorRoot, "../.."), "PHOTO_AVATAR_");
  const provider = photoAvatarProvider(editorRoot, { ...config, ...process.env });
  let busy = false;
  const handle = async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    if (request.url?.split("?", 1)[0] !== PHOTO_ACTOR_ENDPOINT) return next();
    if (request.method === "GET") return reply(response, 200, { available: Boolean(provider) });
    if (request.method !== "POST") return reply(response, 405, { error: "허용되지 않은 요청 방식입니다." });
    const origin = request.headers.origin;
    if (request.headers["sec-fetch-site"] === "cross-site"
      || (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)) {
      return reply(response, 403, { error: "에디터에서 생성 요청을 보내세요." });
    }
    if (!provider) return reply(response, 503, { error: "Pixal3D 전신 복원 서버가 연결되어 있지 않습니다." });
    if (busy) return reply(response, 409, { error: "다른 사진을 복원하고 있습니다. 완료된 뒤 다시 시도하세요." });
    const mime = request.headers["content-type"] ?? "";
    if (!isPhotoActorImageMime(mime)) return reply(response, 415, { error: "PNG, JPEG, WebP 사진을 사용하세요." });
    if (Number(request.headers["content-length"]) > PHOTO_ACTOR_MAX_IMAGE_BYTES) {
      return reply(response, 413, { error: "사진은 12 MiB 이하여야 합니다." });
    }
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once("close", abort);
    try {
      const image = await readPhoto(request);
      if (!image) return reply(response, 413, { error: "사진은 12 MiB 이하여야 합니다." });
      if (!matchesImage(image, mime)) return reply(response, 415, { error: "사진 파일의 형식을 읽을 수 없습니다." });
      const glb = await provider.generate(image, mime, controller.signal);
      if (controller.signal.aborted || response.destroyed) return;
      response.writeHead(200, { "Content-Type": "model/gltf-binary", "Content-Length": glb.length, "Cache-Control": "no-store" });
      response.end(glb);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[photo avatar]", error instanceof Error ? error.message : "Generation failed");
        reply(response, 502, { error: "전신 복원 또는 리깅에 실패했습니다. 에디터 서버 로그를 확인하세요." });
      }
    } finally {
      response.off("close", abort);
      busy = false;
    }
  };
  return {
    name: "sceneforge-photo-avatar",
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
