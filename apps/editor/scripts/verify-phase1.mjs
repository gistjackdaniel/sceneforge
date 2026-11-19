import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const origin = process.env.SCENEFORGE_ORIGIN || "http://127.0.0.1:4173";
const output = resolve(process.env.SCENEFORGE_EVIDENCE_DIR || fileURLToPath(new URL("../../../artifacts/phase1", import.meta.url)));
const capture = process.argv.includes("--capture");
const captureFolder = resolve(process.env.SCENEFORGE_CAPTURE_DIR || fileURLToPath(new URL("../../../.local/phase1-video", import.meta.url)));
await mkdir(output, { recursive: true });

const args = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"];
const webcam = process.env.SCENEFORGE_FAKE_CAMERA;
if (webcam) args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${webcam}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args });
try {
  const page = await browser.newPage({ viewport: { width: 1496, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error); });
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  if (webcam && process.env.SCENEFORGE_FACE_MODEL) {
    await page.route("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", (route) =>
      route.fulfill({ path: process.env.SCENEFORGE_FACE_MODEL, contentType: "application/octet-stream" }));
  }
  const stage = page.getByRole("region", { name: "3D 모션 편집" });
  const open = async () => {
    await page.goto(origin);
    await page.getByRole("button", { name: "Phase 1 검증 샷" }).click();
    await stage.locator(".production-viewport canvas").waitFor({ state: "visible" });
    await page.locator(".production-preview[data-ready='true']").waitFor({ timeout: 45_000 });
  };
  const getJson = async (button, name) => {
    const downloaded = page.waitForEvent("download");
    await stage.getByRole("button", { name: button }).click();
    const saved = await downloaded;
    const file = resolve(output, name);
    await saved.saveAs(file);
    return JSON.parse(await readFile(file, "utf8"));
  };
  const state = (name) => getJson("검증 상태 내보내기", `${name}.json`);
  const screenshot = (name, locator = stage) => locator.screenshot({ path: resolve(output, `${name}.png`), timeout: 20_000 });
  const seek = async (frame) => {
    const range = stage.getByRole("slider", { name: "샷 프레임" });
    await range.evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
    await stage.getByText(`${frame} / 119f`, { exact: true }).waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  };
  const grabTake = async (name) => {
    if (!capture) return;
    const directory = resolve(captureFolder, name);
    await mkdir(directory, { recursive: true });
    const canvas = stage.locator(".production-viewport canvas");
    for (let index = 0; index < 32; index += 1) {
      await seek(Math.floor(index * 120 / 32));
      await canvas.screenshot({ type: "jpeg", quality: 89, path: resolve(directory, `${String(index).padStart(3, "0")}.jpg`) });
    }
  };

  await open();
  const before = await state("before");
  assert.equal(before.time.durationFrames, 120);
  assert.equal(before.actorA.original[0].raw.length, 60);
  assert.equal(before.actorA.evaluated.length, 120);
  assert.notDeepEqual(before.actorA.evaluated[0].position, before.actorA.evaluated[59].position);
  assert(before.camera.take.keys.length);
  const roomResponse = await page.request.get(`${origin}/${before.background.revision.uri}`);
  assert(roomResponse.ok());
  assert.equal(createHash("sha256").update(await roomResponse.body()).digest("hex"), before.background.revision.contentHash);
  assert(before.background.revision.texturedMaterialCount > 0);
  await grabTake("before-frames");
  await seek(45);
  await screenshot("before");
  await stage.getByRole("button", { name: "B 인사하기" }).click();
  await page.locator(".production-checks li[data-pass='true']").last().waitFor({ timeout: 20_000 });
  const after = await state("after");
  assert.notEqual(before.revisionId, after.revisionId);
  assert.notDeepEqual(before.actorB, after.actorB);
  assert.notDeepEqual(before.actorB.frame45.localRotations, after.actorB.frame45.localRotations);
  assert.deepEqual(before.camera, after.camera);
  assert.deepEqual(before.background, after.background);
  assert.deepEqual(before.actorA, after.actorA);
  assert.deepEqual(before.graph.targets, after.graph.targets);
  assert.equal(await page.locator(".production-checks li[data-pass='true']").count(), 4);
  const model = await getJson("생성 조건 내보내기", "conditions.json");
  assert.deepEqual(model.motionConditions, after.graph);
  assert.equal(model.environment.revisionId, after.background.environment.revisionId);
  await screenshot("after");
  await grabTake("after-frames");

  const revisions = stage.getByRole("combobox", { name: "샷 모션 버전" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await undo.click();
  assert.equal(await revisions.inputValue(), before.revisionId);
  await redo.click();
  assert.equal(await revisions.inputValue(), after.revisionId);
  await revisions.selectOption(before.revisionId);
  assert.deepEqual((await state("reverted")).actorB, before.actorB);
  await revisions.selectOption(after.revisionId);
  await open();
  assert.equal(await revisions.inputValue(), after.revisionId);
  assert.deepEqual(await state("reloaded"), after);
  const storedActors = await page.evaluate(({ worldId, shotId }) => {
    const store = JSON.parse(localStorage.getItem("sceneforge-editor-state-v3"));
    const project = typeof store.project === "string" ? JSON.parse(store.project).project : store.project;
    const scene = project?.sceneStates?.[worldId];
    return project?.shots?.[shotId].subjects.map((subject) => scene?.actors[subject.instanceId]);
  }, { worldId: after.background.environment.worldId, shotId: after.shotId });
  assert.equal(storedActors?.length, 2);
  assert(storedActors.every((actor) => actor?.importKey && actor?.assetRef?.revisionId));

  let webcamTracked = false;
  if (webcam) {
    await stage.getByRole("button", { name: "웹캠 표정 켜기" }).click();
    await stage.getByText("웹캠 표정을 적용 중입니다.").waitFor({ timeout: 30_000 });
    webcamTracked = true;
    await screenshot("webcam-stage");
    await stage.getByRole("button", { name: "웹캠 끄기" }).click();
  }

  let generatedPartialMotion;
  let backgroundVersions;
  if (process.argv.includes("--extended")) {
    const prompt = "A person raises both hands above their head, then lowers both arms gently.";
    await stage.getByLabel("Kimodo 지시").fill(prompt);
    await stage.getByLabel("시작 프레임").fill("60");
    await stage.getByLabel("끝 프레임 미포함").fill("105");
    await stage.getByRole("button", { name: "모션 생성 및 적용" }).click();
    await stage.getByText("Kimodo 모션 생성 중").waitFor();
    await stage.getByText("Kimodo 모션 생성 중").waitFor({ state: "hidden", timeout: 180_000 });
    await page.locator(".production-preview[data-ready='true']").waitFor({ timeout: 20_000 });
    await stage.getByText("B 동작 변경", { exact: true }).waitFor();
    const generated = await state("new-motion");
    const span = generated.actorB.spans.find((item) => item.startFrame === 60 && item.endFrame === 105);
    assert(span);
    assert.equal(generated.graph.sources[span.sourceId].prompt, prompt);
    assert.deepEqual(generated.actorB.evaluations.slice(0, 60), after.actorB.evaluations.slice(0, 60));
    assert.notDeepEqual(generated.actorB.evaluations.slice(60, 105), after.actorB.evaluations.slice(60, 105));
    assert.deepEqual(generated.actorB.evaluations.slice(105), after.actorB.evaluations.slice(105));
    assert.deepEqual(generated.actorA, after.actorA);
    assert.deepEqual(generated.camera, after.camera);
    assert.deepEqual(generated.background, after.background);
    generatedPartialMotion = { sha256: span.sourceId, uri: generated.graph.sources[span.sourceId].uri, startFrame: 60, endFrameExclusive: 105 };

    await stage.getByText("3D 배경 가져오기", { exact: true }).click();
    const fixture = fileURLToPath(new URL("../public/worlds/color_block_room/mesh.glb", import.meta.url));
    await stage.locator("input[type=file]").setInputFiles(fixture);
    const worldPicker = stage.getByRole("combobox", { name: "배경 버전" });
    await worldPicker.locator("option").last().waitFor({ state: "attached" });
    await page.waitForFunction(() => document.querySelectorAll(".production-controls select")[2]?.options.length === 3);
    await page.locator(".production-preview[data-ready='true']").waitFor({ timeout: 20_000 });
    const replacement = await state("background-v2");
    const expectedHash = createHash("sha256").update(await readFile(fixture)).digest("hex");
    assert.equal(replacement.background.revision.contentHash, expectedHash);
    assert.equal(replacement.background.environment.worldId, after.background.environment.worldId);
    await open();
    assert.equal(await worldPicker.inputValue(), replacement.background.environment.revisionId);
    await worldPicker.selectOption(after.background.environment.revisionId);
    await page.locator(".production-preview[data-ready='true']").waitFor({ timeout: 20_000 });
    assert.deepEqual((await state("background-reverted")).background, after.background);
    backgroundVersions = [after.background.revision.contentHash, expectedHash];
  }
  assert.deepEqual(errors, []);
  const report = {
    beforeRevision: before.revisionId, afterRevision: after.revisionId,
    cameraTakeUnchanged: true, backgroundSha256Unchanged: before.background.revision.contentHash,
    actorARawRootFramesUnchanged: before.actorA.original[0].raw.length, actorAEvaluatedFramesUnchanged: before.time.durationFrames,
    actorBSkeletonChangedAtFrame: 45, conditionGraphExported: true, persistentRiggedActors: storedActors.map(({ id, assetRef }) => ({ id, assetRef })),
    undo: true, redo: true, revert: true, browserReload: true, webcamTracked, generatedPartialMotion, backgroundVersions,
  };
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
