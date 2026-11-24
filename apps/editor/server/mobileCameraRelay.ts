import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { build } from "vite";
import { z } from "zod";
import { MOBILE_CAMERA_API, MOBILE_CAMERA_PAGE } from "../src/domain/shot/mobileCaptureProtocol";

const phoneScript = "/mobile-camera.js";
const dnsAnswerSchema = z.object({ Status: z.literal(0), Answer: z.array(z.object({ type: z.number() })) });
const phoneHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Permissions-Policy": "xr-spatial-tracking=(self)",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

async function bundlePhone(root: string) {
  const html = await readFile(join(root, MOBILE_CAMERA_PAGE.slice(1)), "utf8");
  const output = await build({
    configFile: false,
    envFile: false,
    root,
    logLevel: "error",
    build: {
      write: false,
      lib: { entry: join(root, "src/mobile-camera/main.ts"), name: "SceneForgePhone", formats: ["iife"] },
    },
  });
  const bundles = Array.isArray(output) ? output : [output];
  const script = bundles.flatMap((bundle) => "output" in bundle ? bundle.output : []).find((item) => item.type === "chunk" && item.isEntry);
  if (!script || script.type !== "chunk") throw new Error("Couldn't bundle the phone camera script.");
  return { html: html.replace("/src/mobile-camera/main.ts", phoneScript), script: script.code };
}

const cloudflaredPath = (root: string) => {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const local = join(root, "../../.local/cloudflared", name);
  return process.env.SCENEFORGE_CLOUDFLARED_PATH || (existsSync(local) ? local : name);
};

function launchTunnel(root: string, port: number, signal: AbortSignal, onDisconnect: () => void) {
  const child = spawn(cloudflaredPath(root), [
    "tunnel", "--config", join(root, "server/mobileCameraRelay.yml"),
    "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${port}`,
  ], {
    signal, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => fail("Cloudflare couldn't start the HTTPS connection. Try again."), 25_000);
    const fail = (message: string) => {
      clearTimeout(timeout);
      reject(new Error(message));
    };
    let recent = "";
    let origin: string | undefined;
    let ready = false;
    const read = (chunk: string) => {
      if (ready) return;
      recent = (recent + chunk).slice(-8192);
      origin ??= recent.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
      if (origin && recent.includes("Registered tunnel connection")) {
        ready = true;
        clearTimeout(timeout);
        resolve(origin);
      }
    };
    child.stdout.setEncoding("utf8").on("data", read);
    child.stderr.setEncoding("utf8").on("data", read);
    child.on("error", (error: NodeJS.ErrnoException) => fail(error.code === "ENOENT"
      ? "Install cloudflared on this computer to connect by QR. USB pairing is also available."
      : "Couldn't start cloudflared."));
    child.once("exit", () => {
      if (ready && !signal.aborted) onDisconnect();
      else fail("Cloudflare closed the HTTPS connection. Try again.");
    });
  });
}

async function waitForPhonePage(origin: string, signal: AbortSignal) {
  const page = new URL(MOBILE_CAMERA_PAGE, origin);
  const dns = new URL("https://cloudflare-dns.com/dns-query");
  dns.searchParams.set("name", page.hostname);
  dns.searchParams.set("type", "A");
  const deadline = Date.now() + 45_000;
  let published = false;
  await pause(4_000, undefined, { signal });
  while (Date.now() < deadline) {
    try {
      const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
      // Wait for DNS publication before the OS resolver can cache a negative answer.
      if (!published) {
        const response = await fetch(dns, { headers: { Accept: "application/dns-json" }, signal: probeSignal });
        const answer = dnsAnswerSchema.safeParse(await response.json());
        published = answer.success && answer.data.Answer.some((record) => record.type === 1);
      }
      if (published) {
        const response = await fetch(page, { redirect: "error", signal: probeSignal });
        await response.body?.cancel();
        if (response.ok && response.headers.get("permissions-policy") === phoneHeaders["Permissions-Policy"]) return;
      }
    } catch {
      signal.throwIfAborted();
    }
    await pause(1_000, undefined, { signal });
  }
  throw new Error("The HTTPS phone link isn't reachable yet. Try connecting again.");
}

export const createMobileCameraRelay = (root: string) => {
  let bundle: ReturnType<typeof bundlePhone> | undefined;
  return async (handleTake: RequestListener, signal: AbortSignal, onDisconnect: () => void): Promise<string> => {
    bundle ??= bundlePhone(root).catch((error: unknown) => { bundle = undefined; throw error; });
    const { html, script } = await bundle;
    signal.throwIfAborted();
    const server = createServer((request, response) => {
      const path = request.url?.split("?")[0];
      if (path === `${MOBILE_CAMERA_API}/take`) return handleTake(request, response);
      const asset = path === MOBILE_CAMERA_PAGE ? { type: "text/html", content: html }
        : path === phoneScript ? { type: "text/javascript", content: script }
        : undefined;
      if (!asset || request.method !== "GET") {
        response.writeHead(404, { "Cache-Control": "no-store" }).end();
        return;
      }
      response.writeHead(200, { ...phoneHeaders, "Content-Type": `${asset.type}; charset=utf-8` }).end(asset.content);
    });
    server.requestTimeout = 60_000;
    try {
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.once("close", () => reject(new Error("The phone camera relay closed.")));
        server.listen({ host: "127.0.0.1", port: 0, signal }, () => {
          const address = server.address();
          if (address && typeof address !== "string") resolve(address.port);
          else reject(new Error("Couldn't open the phone camera relay."));
        });
      });
      signal.addEventListener("abort", () => server.closeAllConnections(), { once: true });
      signal.throwIfAborted();
      const origin = await launchTunnel(root, port, signal, onDisconnect);
      await waitForPhonePage(origin, signal);
      return origin;
    } catch (error) {
      server.close();
      server.closeAllConnections();
      throw error;
    }
  };
};
