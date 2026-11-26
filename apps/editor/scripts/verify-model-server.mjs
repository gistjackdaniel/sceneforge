// Checks MODEL_SERVER_URL routing against real Vite servers on ephemeral ports. Run from apps/editor.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const editorRoot = fileURLToPath(new URL("..", import.meta.url));
const clipDirectory = fileURLToPath(new URL("../../../.local/poses/clips", import.meta.url));
const tunnelError = { error: "랩 모델 서버에 연결할 수 없습니다. SSH 터널을 확인하세요." };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clipPath = (sha) => `/api/kimodo/clips/${sha}.json`;
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const glb = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(60, 7)]);

// Keep a developer's .env.local out of the run: process.env wins over env files in loadEnv.
for (const key of ["PIXAL3D_DIR", "PIXAL3D_PYTHON", "RIG_WORKER_DIR", "RIG_PYTHON", "MIA_DIR", "ARKIT_TEMPLATE"]) {
  process.env[`PHOTO_AVATAR_${key}`] = "";
}

const cacheDir = await mkdtemp(join(tmpdir(), "sceneforge-verify-vite-"));
const servers = [];
// Vite treats port 0 as unset, so ask the OS for a free port and bind it strictly.
async function freePort() {
  const probe = createHttpServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function startEditor(modelServer) {
  process.env.MODEL_SERVER_URL = modelServer ?? "";
  const server = await createServer({
    root: editorRoot,
    configFile: join(editorRoot, "vite.config.ts"),
    cacheDir,
    logLevel: "silent",
    clearScreen: false,
    optimizeDeps: { noDiscovery: true },
    server: { host: "127.0.0.1", port: await freePort(), strictPort: true, watch: null, hmr: false },
  });
  servers.push(server);
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  console.log(`editor ${origin} with MODEL_SERVER_URL=${modelServer ?? "(unset)"}`);
  return origin;
}

const goodClip = Buffer.from(JSON.stringify({ verify: randomUUID() }));
const goodSha = sha256(goodClip);
const badSha = sha256(randomUUID());
const created = [goodSha, badSha].map((sha) => join(clipDirectory, `${sha}.json`));
const seen = [];
const stub = createHttpServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
  const send = (type, body) => {
    response.writeHead(200, { "Content-Type": type, "Content-Length": body.length });
    response.end(body);
  };
  if (request.url === "/api/photo-avatar" && request.method === "GET") return send("application/json", Buffer.from('{"available":true,"stub":true}'));
  if (request.url === "/api/photo-avatar" && request.method === "POST") return send("model/gltf-binary", glb);
  if (request.url === "/api/kimodo/generate" && request.method === "POST") return send("application/json", Buffer.from('{"stub":"kimodo"}'));
  if (request.url === clipPath(goodSha)) return send("application/json", goodClip);
  if (request.url === clipPath(badSha)) return send("application/json", Buffer.from('{"tampered":true}'));
  response.writeHead(404).end();
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
const stubOrigin = `http://127.0.0.1:${stub.address().port}`;
const results = [];
const check = async (name, run) => {
  await run();
  results.push(name);
  console.log(`ok - ${name}`);
};

try {
  await check("invalid MODEL_SERVER_URL fails at config time", async () => {
    await assert.rejects(startEditor("http://127.0.0.1:4180/api"), /MODEL_SERVER_URL must be an http or https origin/);
  });

  const proxied = await startEditor(stubOrigin);
  const proxiedHost = new URL(proxied).host;

  await check("a. GET /api/photo-avatar returns the stub body", async () => {
    const response = await fetch(`${proxied}/api/photo-avatar`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"available":true,"stub":true}');
  });

  await check("a. POST /api/photo-avatar returns the stub GLB with headers unchanged", async () => {
    const response = await fetch(`${proxied}/api/photo-avatar`, {
      method: "POST", body: png,
      headers: { "Content-Type": "image/png", Origin: proxied, "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "model/gltf-binary");
    assert.equal(response.headers.get("content-length"), String(glb.length));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), glb);
    const forwarded = seen.findLast((entry) => entry.method === "POST" && entry.url === "/api/photo-avatar");
    assert.equal(forwarded.headers.host, proxiedHost);
    assert.equal(forwarded.headers.origin, proxied);
    assert.equal(forwarded.headers["sec-fetch-site"], "same-origin");
    assert.deepEqual(forwarded.body, png);
  });

  await check("a. POST /api/kimodo/generate reaches the stub", async () => {
    const response = await fetch(`${proxied}/api/kimodo/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"prompt":"walk","seconds":2,"seed":0}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { stub: "kimodo" });
    assert.ok(seen.some((entry) => entry.method === "POST" && entry.url === "/api/kimodo/generate"));
  });

  await check("b. a missing clip is copied from the model server into the local cache", async () => {
    assert.equal(existsSync(created[0]), false);
    const response = await fetch(`${proxied}${clipPath(goodSha)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), goodClip);
    assert.equal(existsSync(created[0]), true);
  });

  await check("b. a clip whose bytes don't match its name returns 502 and leaves no file", async () => {
    const response = await fetch(`${proxied}${clipPath(badSha)}`);
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    assert.equal(existsSync(created[1]), false);
    assert.deepEqual((await readdir(clipDirectory)).filter((name) => name.startsWith(".fetch-")), []);
  });

  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));

  await check("b. with the model server down, the cached clip is served locally", async () => {
    const response = await fetch(`${proxied}${clipPath(goodSha)}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), goodClip);
  });

  await check("d. with the model server down, POST /api/kimodo/generate returns 503 JSON", async () => {
    const response = await fetch(`${proxied}/api/kimodo/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"prompt":"walk","seconds":2,"seed":0}',
    });
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(await response.json(), tunnelError);
  });

  const remote = await startEditor(undefined);

  await check("3. without MODEL_SERVER_URL, GET /api/photo-avatar is answered locally", async () => {
    const response = await fetch(`${remote}/api/photo-avatar`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false });
  });

  const throughRemote = await startEditor(remote);

  await check("c. the real remote's origin check passes through the proxy (503, not 403)", async () => {
    const response = await fetch(`${throughRemote}/api/photo-avatar`, {
      method: "POST", body: png,
      headers: { "Content-Type": "image/png", Origin: throughRemote, "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Pixal3D 전신 복원 서버가 연결되어 있지 않습니다." });
  });

  await check("c. the real remote still rejects a foreign origin through the proxy (403)", async () => {
    const response = await fetch(`${throughRemote}/api/photo-avatar`, {
      method: "POST", body: png,
      headers: { "Content-Type": "image/png", Origin: "http://attacker.example", "Sec-Fetch-Site": "cross-site" },
    });
    assert.equal(response.status, 403);
  });
} finally {
  stub.closeAllConnections();
  stub.close();
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(created.map((file) => rm(file, { force: true })));
  await rm(cacheDir, { recursive: true, force: true });
}
console.log(`${results.length} checks passed`);
