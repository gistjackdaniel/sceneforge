import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const origin = process.env.SCENEFORGE_ORIGIN || "http://127.0.0.1:4173";
const photo = process.env.SCENEFORGE_PHOTO;
const webcam = process.env.SCENEFORGE_FAKE_CAMERA;
const build = process.env.SCENEFORGE_PHOTO_BODY || "male";
const prompt = process.env.SCENEFORGE_KIMODO_PROMPT || "A person raises both arms above the head";
const output = resolve(process.env.SCENEFORGE_EVIDENCE_DIR || fileURLToPath(new URL("../../../artifacts/photo-actor", import.meta.url)));
assert(photo, "Set SCENEFORGE_PHOTO to a frontal portrait.");
assert(webcam, "Set SCENEFORGE_FAKE_CAMERA to a Y4M face video.");
await mkdir(output, { recursive: true });

const args = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${webcam}`];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args });
const report = { photo: basename(photo), body: build };
try {
  const page = await browser.newPage({ viewport: { width: 1496, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error); });
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  if (process.env.SCENEFORGE_FACE_MODEL) {
    await page.route("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", (route) =>
      route.fulfill({ path: process.env.SCENEFORGE_FACE_MODEL, contentType: "application/octet-stream" }));
  }

  const stage = page.getByRole("region", { name: "Scene workspace" });
  const picker = stage.getByRole("combobox", { name: "샷 선택" });
  const controls = stage.getByRole("complementary", { name: "샷 편집" });
  const canvas = stage.getByLabel("편집 가능한 3D 샷", { exact: true });
  const actorPicker = controls.getByRole("combobox", { name: "모션 액터" });
  const demoId = "shot-phase1-edit-review";
  const frames = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  const seek = async (frame) => {
    await stage.getByRole("slider", { name: "샷 프레임" }).evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
    await frames();
  };
  const shoot = async (name) => {
    await frames();
    // Rig warnings are DOM text over the canvas, not part of the rendered shot.
    const bytes = await canvas.screenshot({ path: resolve(output, `${name}.png`), style: ".viewport-rig-warnings { visibility: hidden !important; }" });
    return bytes.toString("base64");
  };
  // Pixels whose RGB differs by more than 24 levels, and the box that holds them, in canvas pixels.
  const difference = (a, b) => page.evaluate(async ([left, right]) => {
    const decode = async (data) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    };
    const [x, y] = await Promise.all([decode(left), decode(right)]);
    let changed = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let index = 0; index < x.data.length; index += 4) {
      const delta = Math.max(...[0, 1, 2].map((channel) => Math.abs(x.data[index + channel] - y.data[index + channel])));
      if (delta <= 24) continue;
      changed += 1;
      const pixel = index / 4, px = pixel % x.width, py = Math.floor(pixel / x.width);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    return { changed, box: changed ? [minX, minY, maxX, maxY] : null };
  }, [a, b]);
  // Software WebGL draws a few frames per second, so orbit damping can run for many seconds.
  const settle = async () => {
    let previous = (await canvas.screenshot()).toString("base64");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await page.waitForTimeout(500);
      const next = (await canvas.screenshot()).toString("base64");
      if ((await difference(previous, next)).changed === 0) return;
      previous = next;
    }
    throw new Error("The viewport camera did not come to rest.");
  };
  // Hide the other actors, aim the free camera at the photo actor's feet with Focus, then pan up and dolly in.
  const frame = async (name, { pan, zoom }) => {
    if (await stage.getByRole("button", { name: "샷 카메라" }).getAttribute("aria-pressed") === "true") {
      await stage.getByRole("button", { name: "샷 카메라" }).click();
    }
    await stage.getByRole("button", { name: "Subjects" }).click();
    const layers = stage.getByRole("complementary", { name: "layers panel" });
    for (const other of await layers.locator("button[aria-label^='Hide ']").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))) {
      if (other !== `Hide ${name}`) await layers.getByRole("button", { name: other, exact: true }).click();
    }
    await layers.getByRole("button", { name, exact: true }).click();
    await stage.getByRole("button", { name: "Focus selection F" }).click();
    await stage.getByRole("button", { name: "Close panel" }).click();
    await stage.getByRole("button", { name: "Orbit · Q" }).click();
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(x, y + pan, { steps: 12 });
    await page.mouse.up({ button: "right" });
    await page.mouse.move(x, y);
    for (let step = 0; step < zoom; step += 1) await page.mouse.wheel(0, -100);
    await settle();
  };
  const open = async () => {
    await page.goto(origin);
    await stage.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Scene", exact: true }).click();
    if (await picker.inputValue() !== demoId) await picker.selectOption(demoId);
    await canvas.waitFor({ state: "visible" });
    await stage.locator(".production-controls[data-ready='true']").waitFor({ state: "attached", timeout: 60_000 });
  };

  await open();
  await stage.getByRole("button", { name: "Add assets" }).click();
  const asset = stage.getByRole("region", { name: "사진으로 3D 사람 만들기" });
  await asset.getByLabel("체형").selectOption(build);
  await asset.getByLabel("인물 사진").setInputFiles(photo);
  const started = Date.now();
  await asset.getByRole("button", { name: "3D 사람 추가" }).click();
  await controls.waitFor({ state: "visible", timeout: 180_000 }).catch(async (cause) => {
    const alert = await asset.getByRole("alert").textContent().catch(() => null);
    throw new Error(alert ?? cause.message);
  });
  report.generationSeconds = Math.round((Date.now() - started) / 100) / 10;
  const name = basename(photo).replace(/\.[^.]+$/, "");
  const actorId = await actorPicker.locator("option", { hasText: name }).getAttribute("value");
  assert(actorId?.startsWith("actor-"), "The photo actor was not added to the shot.");
  await actorPicker.selectOption(actorId);
  report.actorId = actorId;

  await seek(0);
  await frame(name, { pan: 260, zoom: 18 });

  const webcamOff = await shoot("face-webcam-off");
  const webcamButton = controls.getByRole("button", { name: "웹캠 표정 켜기" });
  assert(await webcamButton.isEnabled(), "The photo actor has no webcam expression channels.");
  await webcamButton.click();
  await controls.getByText("웹캠 표정을 적용 중입니다.").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const webcamOn = await shoot("face-webcam-on");
  report.webcamExpression = await difference(webcamOff, webcamOn);
  await controls.getByRole("button", { name: "웹캠 끄기" }).click();
  await frames();
  report.webcamOffRestores = await difference(webcamOff, await shoot("face-webcam-off-again"));

  await frame(name, { pan: 100, zoom: 0 });
  await seek(45);
  const restPose = await shoot("body-before-kimodo");
  await controls.getByLabel("Kimodo 지시").fill(prompt);
  await controls.getByLabel("시작 프레임").fill("0");
  await controls.getByLabel("끝 프레임 미포함").fill("90");
  const generate = controls.getByRole("button", { name: "모션 생성 및 적용" });
  assert(await generate.isEnabled(), "The photo actor has no Kimodo body joints.");
  const kimodoStarted = Date.now();
  await generate.click();
  await controls.getByText("Kimodo 모션 생성 중").waitFor();
  await controls.getByText("Kimodo 모션 생성 중").waitFor({ state: "hidden", timeout: 300_000 });
  report.kimodoSeconds = Math.round((Date.now() - kimodoStarted) / 100) / 10;
  await stage.locator(".production-controls[data-ready='true']").waitFor({ state: "attached", timeout: 60_000 });
  await controls.getByText(prompt, { exact: true }).waitFor().catch(() => {});
  await seek(45);
  const moved = await shoot("body-after-kimodo");
  report.kimodoMotion = await difference(restPose, moved);
  report.kimodoPrompt = prompt;

  await open();
  await controls.waitFor({ state: "attached" });
  const reloadedIds = await actorPicker.locator("option").evaluateAll((options) => options.map((option) => option.value));
  report.persistedAfterReload = reloadedIds.includes(actorId);
  assert(report.persistedAfterReload, "The photo actor was missing after reload.");
  await actorPicker.selectOption(actorId);
  report.webcamAvailableAfterReload = await controls.getByRole("button", { name: "웹캠 표정 켜기" }).isEnabled();
  await frame(name, { pan: 100, zoom: 0 });
  await seek(45);
  report.reloadMatchesMotion = await difference(moved, await shoot("body-after-reload"));
  report.pageErrors = errors;

  assert(report.webcamExpression.changed > 50, "Webcam expression did not change the photo actor.");
  assert(report.webcamOffRestores.changed < report.webcamExpression.changed / 5, "Turning the webcam off did not restore the face.");
  assert(report.kimodoMotion.changed > 500, "Kimodo motion did not move the photo actor.");
  assert(report.reloadMatchesMotion.changed < report.kimodoMotion.changed / 10, "The reloaded actor did not replay the saved motion.");
  assert(report.webcamAvailableAfterReload, "Webcam expression channels were missing after reload.");
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
