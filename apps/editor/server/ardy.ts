import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadEnv, type Connect, type Plugin } from "vite";
import { z } from "zod";
import { somaMotionSchema, type SomaClipReference } from "../src/domain/sceneAuthoring/somaMotion";
import { wslInvocation } from "./photoAvatarProvider";

const MAX_REQUEST_BYTES = 16_384;
// Loading the 15 GB text encoder takes about a minute and a half; a step takes a fraction of a second.
const START_TIMEOUT_MS = 300_000;
const STEP_TIMEOUT_MS = 20_000;
// ARDY keeps the 15 GB text encoder in memory, so it exits when steering pauses.
const IDLE_MS = 120_000;

const prompt = z.string().trim().max(500);
const requests = {
  start: z.strictObject({ prompt }),
  step: z.strictObject({
    frame: z.number().int().min(0).max(1_000_000),
    velocity: z.tuple([z.number().min(-5).max(5), z.number().min(-5).max(5)]),
    prompt: prompt.optional(),
  }),
  clip: z.strictObject({ from: z.number().int().min(0), to: z.number().int().positive() })
    .refine(({ from, to }) => to > from && to - from <= 300, "Save between 1 and 300 frames."),
};
type Kind = keyof typeof requests;

function respond(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** One long-lived ARDY process answering JSON lines in order. */
class ArdyProcess {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, { resolve: (reply: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private next = 1;
  private idle?: NodeJS.Timeout;
  private stderrTail = "";
  stopped = false;

  constructor(python: string, script: string, cwd: string, private readonly onExit: () => void) {
    const stageEnv = { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" };
    const { command, argv, inWsl } = wslInvocation(python, [script], cwd);
    this.child = spawn(command, argv, {
      cwd: inWsl ? undefined : cwd,
      env: { ...process.env, ...stageEnv, ...(inWsl ? { WSLENV: [process.env.WSLENV, ...Object.keys(stageEnv)].filter(Boolean).join(":") } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    createInterface({ input: this.child.stdout! }).on("line", (line) => {
      let reply: Record<string, unknown>;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.waiting.get(Number(reply.id));
      if (!pending) return;
      this.waiting.delete(Number(reply.id));
      clearTimeout(pending.timer);
      if (typeof reply.error === "string") pending.reject(new Error(reply.error));
      else pending.resolve(reply);
    });
    this.child.stderr!.setEncoding("utf8").on("data", (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-4_096); });
    // A write to a process that just died fails here instead of crashing the editor server; exit rejects the request.
    this.child.stdin!.on("error", () => undefined);
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      this.stopped = true;
      const lines = this.stderrTail.trim().split(/\r?\n/);
      if (this.waiting.size) console.error(`[ARDY] ${reason}: ${lines[lines.length - 1] ?? ""}`);
      for (const pending of this.waiting.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("ARDY stopped."));
      }
      this.waiting.clear();
      clearTimeout(this.idle);
      this.onExit();
    };
    this.child.on("exit", () => end("exited"));
    this.child.on("error", (error) => end(error.message));
  }

  request(body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("ARDY did not answer in time."));
        // Requests run in order, so one that misses its deadline holds up every later one.
        this.stop();
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.child.stdin!.write(`${JSON.stringify({ id, ...body })}\n`);
    });
  }

  stop(): void {
    this.stopped = true;
    this.child.stdin?.end();
    this.child.kill();
  }
}

/** Live ARDY steering for the editor. ARDY_PYTHON is the Python of an environment with ARDY installed. */
export function ardyPlugin(editorRoot: string, mode: string): Plugin {
  const repoRoot = join(editorRoot, "../..");
  const python = loadEnv(mode, repoRoot, "ARDY_").ARDY_PYTHON?.trim();
  const script = join(editorRoot, "scripts", "ardy_server.py");
  const cacheDirectory = join(repoRoot, ".local", "poses", "clips");
  let ardy: ArdyProcess | undefined;
  // A stopped process can take a moment to exit; start a fresh one instead of writing to it.
  const running = () => {
    if (!ardy || ardy.stopped) {
      const created = new ArdyProcess(python!, script, editorRoot, () => { if (ardy === created) ardy = undefined; });
      ardy = created;
    }
    return ardy;
  };

  // Keep the clip like a Kimodo clip: content-addressed in the same cache, served by the Kimodo route.
  const storeClip = async (clip: unknown): Promise<SomaClipReference> => {
    const motion = somaMotionSchema.parse(clip);
    const payload = Buffer.from(JSON.stringify(motion));
    const sha256 = createHash("sha256").update(payload).digest("hex");
    await mkdir(cacheDirectory, { recursive: true });
    const temporary = join(cacheDirectory, `.ardy-${randomUUID()}.json`);
    try {
      await writeFile(temporary, payload);
      await rename(temporary, join(cacheDirectory, `${sha256}.json`));
    } finally {
      await rm(temporary, { force: true });
    }
    const { model, prompt: text, seed, fps, frames } = motion;
    return { uri: `/api/kimodo/clips/${sha256}.json`, sha256, model, prompt: text, seed, fps, frameCount: frames.length };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const kind = /^\/api\/ardy\/(start|step|clip|stop)$/.exec(request.url?.split("?", 1)[0] ?? "")?.[1] as Kind | "stop" | undefined;
    if (!kind) return next();
    if (request.method !== "POST") return respond(response, 405, { error: "Use POST." });
    if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
      return respond(response, 403, { error: "Open SceneForge to steer an actor." });
    }
    if (kind === "stop") {
      ardy?.stop();
      return respond(response, 200, { stopped: true });
    }
    if (!python) return respond(response, 503, { error: "ARDY 런타임이 없습니다. .env.local에 ARDY_PYTHON을 설정하세요." });
    const parsed = requests[kind].safeParse(await readJson(request));
    if (!parsed.success) return respond(response, 400, { error: "Send a valid ARDY request." });
    if (kind !== "start" && !ardy) return respond(response, 409, { error: "Start live steering first." });
    try {
      const reply = await running().request({ type: kind, ...parsed.data }, kind === "start" ? START_TIMEOUT_MS : STEP_TIMEOUT_MS);
      if (kind === "clip") return respond(response, 200, await storeClip(reply.clip));
      const { id: _id, ...rest } = reply;
      respond(response, 200, rest);
    } catch (error) {
      console.error("[ARDY]", error instanceof Error ? error.message : error);
      respond(response, 500, { error: "ARDY couldn't generate motion. See the editor server log." });
    }
  };

  const register = (middlewares: Connect.Server) => middlewares.use(handle);
  return {
    name: "sceneforge-ardy",
    configureServer(server) {
      register(server.middlewares);
      server.httpServer?.on("close", () => ardy?.stop());
    },
    configurePreviewServer(server) { register(server.middlewares); },
  };
}
