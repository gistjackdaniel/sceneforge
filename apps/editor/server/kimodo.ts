import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { loadEnv, type Connect, type Plugin } from "vite";
import { somaGenerationRequestSchema, somaMotionSchema, type SomaClipReference } from "../src/domain/sceneAuthoring/somaMotion";
import type { z } from "zod";

type Request = z.infer<typeof somaGenerationRequestSchema>;

const MAX_REQUEST_BYTES = 8192;
const GENERATION_TIMEOUT_MS = 600_000;
const CLIP_FETCH_TIMEOUT_MS = 60_000;
const CLIP_PATH = /^\/api\/kimodo\/clips\/([a-f0-9]{64})\.json$/;

function respond(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readRequest(request: IncomingMessage): Promise<Request | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    const parsed = somaGenerationRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function runGenerator(python: string, script: string, file: string, request: Request, cwd: string,
  env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(python, [script, file, `--prompt=${request.prompt}`, `--seconds=${request.seconds}`,
      `--seed=${request.seed}`], { cwd, env, signal, shell: false, stdio: "ignore", windowsHide: true });
    let failure: Error | undefined;
    child.once("error", (error) => { failure = error; });
    child.on("close", (code, reason) => {
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`Kimodo exited with ${reason ?? code}.`));
    });
  });
}

function defaultPython(): string {
  const venv = process.env.VIRTUAL_ENV;
  const venvPython = venv && (process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python"));
  if (venvPython && existsSync(venvPython)) return venvPython;
  const local = process.env.LOCALAPPDATA;
  const installed = local && join(local, "Programs", "Python", "Python312", "python.exe");
  return installed && existsSync(installed) ? installed : "python";
}

/** Fetch a clip from the model server and keep it only when its bytes hash to its name. */
async function fetchRemoteClip(modelServer: URL, pathname: string, sha256: string, cacheDirectory: string): Promise<Buffer> {
  const response = await fetch(new URL(pathname, modelServer), { signal: AbortSignal.timeout(CLIP_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Model server answered ${response.status}.`);
  const payload = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(payload).digest("hex") !== sha256) throw new Error("Model server clip does not match its hash.");
  await mkdir(cacheDirectory, { recursive: true });
  const temporary = join(cacheDirectory, `.fetch-${randomUUID()}.json`);
  try {
    await writeFile(temporary, payload);
    await rename(temporary, join(cacheDirectory, `${sha256}.json`));
  } finally {
    await rm(temporary, { force: true });
  }
  return payload;
}

/**
 * Serve immutable, content-addressed SOMA clips and run the local Kimodo provider.
 * With a model server, generation is proxied there and clips missing here are copied from it.
 */
export function kimodoMotionPlugin(editorRoot: string, mode: string, modelServer?: URL): Plugin {
  const repoRoot = join(editorRoot, "../..");
  const config = loadEnv(mode, repoRoot, ["KIMODO_PYTHON", "CHECKPOINT_DIR", "TEXT_ENCODER_DEVICE", "HF_TOKEN"]);
  const cacheDirectory = join(repoRoot, ".local", "poses", "clips");
  const script = join(editorRoot, "scripts", "kimodo_motion.py");
  const python = config.KIMODO_PYTHON || defaultPython();
  const env = {
    ...process.env,
    ...config,
    CHECKPOINT_DIR: config.CHECKPOINT_DIR || join(repoRoot, ".local", "checkpoints"),
    TEXT_ENCODER_DEVICE: config.TEXT_ENCODER_DEVICE || "cpu",
    PYTHONDONTWRITEBYTECODE: "1",
  };
  let busy = false;

  const serveClip = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = request.url?.split("?", 1)[0] ?? "";
    const clip = CLIP_PATH.exec(pathname);
    if (request.method !== "GET" || !clip) return next();
    let payload: Buffer;
    try {
      payload = await readFile(join(cacheDirectory, `${clip[1]}.json`));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") return respond(response, 500, { error: "Couldn't read this motion clip." });
      if (!modelServer) return respond(response, 404, { error: "Couldn't read this motion clip." });
      try {
        payload = await fetchRemoteClip(modelServer, pathname, clip[1], cacheDirectory);
      } catch (remoteError) {
        console.error("Kimodo clip fetch failed", remoteError instanceof Error ? remoteError.message : remoteError);
        return respond(response, 502, { error: "Couldn't copy this motion clip from the model server." });
      }
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" });
    response.end(payload);
  };

  const generate = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = request.url?.split("?", 1)[0] ?? "";
    if (pathname !== "/api/kimodo/generate") return next();
    if (request.method !== "POST") return respond(response, 405, { error: "Use POST to generate motion." });
    if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
      return respond(response, 403, { error: "Open SceneForge to generate motion." });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
      return respond(response, 415, { error: "Send the motion prompt as JSON." });
    }
    if (busy) return respond(response, 409, { error: "Kimodo is generating another clip. Try again when it finishes." });
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    const cancel = () => controller.abort();
    response.once("close", cancel);
    let temporary: string | undefined;
    try {
      const input = await readRequest(request);
      if (!input) return respond(response, 400, { error: "Enter a motion prompt between 0.5 and 10 seconds." });
      await mkdir(cacheDirectory, { recursive: true });
      temporary = await mkdtemp(join(cacheDirectory, ".job-"));
      const output = join(temporary, "motion.json");
      await runGenerator(python, script, output, input, repoRoot, env, controller.signal);
      controller.signal.throwIfAborted();
      const payload = await readFile(output);
      const { model, prompt, seed, fps, frames } = somaMotionSchema.parse(JSON.parse(payload.toString("utf8")));
      const sha256 = createHash("sha256").update(payload).digest("hex");
      await rename(output, join(cacheDirectory, `${sha256}.json`));
      const reference: SomaClipReference = { uri: `/api/kimodo/clips/${sha256}.json`, sha256, model, prompt, seed, fps, frameCount: frames.length };
      respond(response, 200, reference);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      console.error("Kimodo generation failed", { status: "failed", code, cancelled: controller.signal.aborted });
      respond(response, controller.signal.aborted ? 504 : 500, {
        error: controller.signal.aborted ? "Kimodo generation was cancelled or timed out." : "Kimodo couldn't generate motion. Check the local Python and model installation.",
      });
    } finally {
      clearTimeout(timeout);
      response.off("close", cancel);
      if (temporary) {
        await rm(temporary, { recursive: true, force: true }).catch(() => {
          console.error("Could not clean up the Kimodo work directory.");
        });
      }
      busy = false;
    }
  };

  const register = (middlewares: Connect.Server) => {
    middlewares.use(serveClip);
    if (!modelServer) middlewares.use(generate);
  };
  return {
    name: "sceneforge-kimodo",
    configureServer(server) { register(server.middlewares); },
    configurePreviewServer(server) { register(server.middlewares); },
  };
}
