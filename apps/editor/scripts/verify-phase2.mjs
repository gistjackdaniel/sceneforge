import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const origin = process.env.SCENEFORGE_ORIGIN || "http://localhost:4173";
const output = resolve(process.env.SCENEFORGE_EVIDENCE_DIR || fileURLToPath(new URL("../../../.local/phase2", import.meta.url)));
await mkdir(output, { recursive: true });

function unpackTar(archive) {
  const files = new Map();
  for (let offset = 0; archive[offset];) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().split("\0")[0];
    const size = Number.parseInt(header.subarray(124, 136).toString(), 8);
    files.set(name, archive.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
try {
  const desktop = await browser.newContext({ viewport: { width: 1496, height: 900 }, acceptDownloads: true });
  const editor = await desktop.newPage();
  const errors = [];
  editor.on("pageerror", (error) => errors.push(error.message));
  await editor.goto(origin);
  const stage = editor.getByRole("region", { name: "Scene workspace" });
  const picker = stage.getByRole("combobox", { name: "샷 선택" });
  await stage.getByRole("button", { name: "Scene", exact: true }).click();
  await picker.selectOption("shot-phase1-edit-review");
  await stage.getByRole("button", { name: "Camera trajectory" }).click();
  await stage.getByRole("button", { name: "Connect phone camera" }).click();
  const link = stage.getByRole("textbox", { name: "Phone link" });
  await link.waitFor();
  const cancelled = new URL(await link.inputValue());
  const metadata = `${origin}/api/mobile-camera/take`;
  await stage.getByRole("button", { name: "Cancel pairing" }).click();
  await stage.getByRole("button", { name: "Connect phone camera" }).click();
  await link.waitFor();
  assert.equal((await fetch(metadata, { headers: { Authorization: `Bearer ${cancelled.hash.slice(1)}` } })).status, 404);
  const connected = new URL(await link.inputValue());
  assert.equal((await fetch(`${origin}/api/mobile-camera/pair`, { headers: { Authorization: `Bearer ${connected.hash.slice(1)}` } })).status, 404);
  await editor.screenshot({ path: resolve(output, "desktop-pairing.png"), mask: [link], maskColor: "#37463d" });

  const mobile = await browser.newContext({ viewport: { width: 412, height: 800 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(() => {
    class SimulatedSession extends EventTarget {
      index = 0;
      ended = false;
      updateRenderState() {}
      async requestReferenceSpace() { return new EventTarget(); }
      async end() {
        this.ended = true;
        this.dispatchEvent(new Event("end"));
      }
      requestAnimationFrame(callback) {
        return setTimeout(() => {
          if (this.ended) return;
          const index = this.index++;
          const angle = index * 0.001;
          const c = Math.cos(angle);
          const s = Math.sin(angle);
          const z = 8 + (index >= 28 ? 0.4 : 0) + (index >= 50 ? 0.3 : 0);
          const view = {
            transform: { matrix: Float32Array.of(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 4 + index * 0.003, 2, z, 1) },
            projectionMatrix: Float32Array.of(1.5, 0, 0, 0, 0, 2.05, 0, 0, -0.1, 0.1, -1, -1, 0, 0, -0.1, 0),
          };
          const lost = index >= 20 && index < 28 || index >= 43 && index < 50;
          callback(1_000 + index * 1_000 / 60, { getViewerPose: () => lost ? null : { emulatedPosition: false, views: [view] } });
        }, 1);
      }
    }
    Object.defineProperty(navigator, "xr", { value: {
      isSessionSupported: async (mode) => mode === "immersive-ar",
      requestSession: async () => new SimulatedSession(),
    } });
    window.XRWebGLLayer = class {
      framebuffer = null;
      getViewport() { return { width: 1080, height: 1920 }; }
    };
  });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(connected.href);
  await phone.getByText(/Paired · .* fps/).waitFor();
  await phone.screenshot({ path: resolve(output, "phone-paired.png") });
  await phone.getByRole("button", { name: "Start AR" }).click();
  await phone.getByRole("button", { name: "Take sent" }).waitFor({ timeout: 25_000 });
  await stage.getByText("Phone take saved. The shot camera is selected.").waitFor();
  await stage.getByRole("button", { name: "Close panel" }).click();
  await stage.getByRole("button", { name: "재생", exact: true }).click();
  await editor.waitForFunction(() => Number(document.querySelector(".scene-shot-transport input")?.value) > 0);
  await stage.getByRole("button", { name: "일시정지", exact: true }).click();
  await editor.screenshot({ path: resolve(output, "desktop-phone-take.png") });

  const exportPasses = async (label) => {
    await stage.getByRole("button", { name: "Scene output" }).click();
    const downloading = editor.waitForEvent("download", { timeout: 60_000 });
    await stage.getByRole("button", { name: "Export render passes" }).click();
    const download = await downloading;
    const path = resolve(output, `${label}.tar`);
    await download.saveAs(path);
    await stage.getByText("Render passes downloaded.").waitFor();
    await editor.screenshot({ path: resolve(output, `${label}.png`) });
    return readFile(path);
  };
  const first = await exportPasses("recorded");
  await editor.reload();
  await stage.getByRole("button", { name: "Scene", exact: true }).click();
  assert.equal(await picker.inputValue(), "shot-phase1-edit-review");
  await stage.getByText(/Phone camera · \d+ keys/).waitFor();
  const restored = await exportPasses("restored");
  assert(first.equals(restored), "Reloaded archive bytes differ");

  const files = unpackTar(restored);
  const manifest = JSON.parse(files.get("manifest.json"));
  const camera = JSON.parse(files.get("camera.json"));
  const shot = JSON.parse(files.get("scene.json"));
  const take = shot.camera.takes.find((take) => take.id === manifest.cameraId);
  assert.equal(take.name, "Phone camera");
  assert.equal(take.calibration.arFramework, "webxr");
  assert.equal(manifest.fps, shot.time.fps);
  assert.equal(take.samples[0].timecode, "00:00:00:00");
  assert.equal(camera.trajectory.length, shot.time.durationFrames);
  assert.notDeepEqual(take.samples[0].position, camera.trajectory[0].position);
  assert.notDeepEqual(camera.trajectory[0].position, camera.trajectory.at(-1).position);
  assert.notEqual(camera.trajectory[0].intrinsics.cx, manifest.spec.width / 2);
  assert.equal(camera.trackingEvents.filter((event) => event.kind === "tracking_lost").length, 2);
  const corrections = camera.trackingEvents.filter((event) => event.kind === "drift_correction");
  assert.equal(corrections.length, 2);
  assert(Math.abs(corrections[1].correction.translation[2]) > Math.abs(corrections[0].correction.translation[2]));
  const pixels = manifest.spec.width * manifest.spec.height * camera.trajectory.length;
  const bytesPerPixel = { rgb: 3, depth: 4, normal: 12, world_position: 12, instance_id: 4, surface_tracking: 16 };
  for (const [pass, bytes] of Object.entries(bytesPerPixel)) {
    const buffer = files.get(`${pass}.bin`);
    assert.equal(buffer.length, pixels * bytes);
    assert(buffer.some((byte) => byte !== 0), `${pass} contains no geometry`);
  }
  assert.deepEqual(errors, []);
  const summary = {
    device: "Simulated WebXR poses in Android-sized Chromium viewport",
    cameraTake: take.id,
    fps: manifest.fps,
    frames: camera.trajectory.length,
    trackingLosses: 2,
    driftCorrections: corrections.length,
    passes: Object.keys(bytesPerPixel),
    archiveBytes: restored.length,
    archiveSha256BeforeAndAfterReload: createHash("sha256").update(restored).digest("hex"),
  };
  await writeFile(resolve(output, "verification.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
