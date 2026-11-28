import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Drive actor B's upper body from a fake webcam: off, on, and off again, comparing the rendered shot each time.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const origin = process.env.SCENEFORGE_ORIGIN || "http://127.0.0.1:4173";
const webcam = process.env.SCENEFORGE_FAKE_CAMERA;
const poseModel = process.env.SCENEFORGE_POSE_MODEL;
const faceModel = process.env.SCENEFORGE_FACE_MODEL;
const output = resolve(process.env.SCENEFORGE_EVIDENCE_DIR || ".local/webcam-body");
assert(webcam, "Set SCENEFORGE_FAKE_CAMERA to a Y4M video of a person whose arms are away from their sides.");
assert(poseModel, "Set SCENEFORGE_POSE_MODEL to a local pose_landmarker_lite.task.");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH, headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${webcam}`],
});
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1496, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    (route) => route.fulfill({ path: poseModel, contentType: "application/octet-stream" }));
  if (faceModel) {
    await page.route("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      (route) => route.fulfill({ path: faceModel, contentType: "application/octet-stream" }));
  }
  const stage = page.getByRole("region", { name: "Scene workspace" });
  const controls = stage.getByRole("complementary", { name: "샷 편집" });
  const canvas = stage.getByLabel("편집 가능한 3D 샷", { exact: true });
  await page.goto(origin);
  await stage.getByRole("group", { name: "Workspace mode" }).getByRole("button", { name: "Scene", exact: true }).click();
  const picker = stage.getByRole("combobox", { name: "샷 선택" });
  if (await picker.inputValue() !== "shot-phase1-edit-review") await picker.selectOption("shot-phase1-edit-review");
  await stage.locator(".production-controls[data-ready='true']").waitFor({ state: "attached", timeout: 60_000 });
  report.actor = await controls.getByRole("combobox", { name: "모션 액터" }).inputValue();

  const frames = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  const shoot = async (name) => {
    await frames();
    const bytes = await canvas.screenshot({ path: resolve(output, `${name}.png`), style: ".viewport-rig-warnings { visibility: hidden !important; }" });
    return bytes.toString("base64");
  };
  const difference = (a, b) => page.evaluate(async ([left, right]) => {
    const decode = async (data) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const context = new OffscreenCanvas(image.width, image.height).getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    };
    const [x, y] = await Promise.all([decode(left), decode(right)]);
    let changed = 0;
    for (let index = 0; index < x.data.length; index += 4) {
      if (Math.max(...[0, 1, 2].map((channel) => Math.abs(x.data[index + channel] - y.data[index + channel]))) > 24) changed += 1;
    }
    return changed;
  }, [a, b]);

  const off = await shoot("webcam-body-off");
  const body = controls.getByLabel("상체도 웹캠으로 움직이기");
  if (await body.isEnabled()) await body.check();
  await controls.getByRole("button", { name: "웹캠 표정 켜기" }).click();
  await controls.getByText(/상체 동작을 적용 중입니다/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const on = await shoot("webcam-body-on");
  report.webcamBodyChange = await difference(off, on);
  await controls.getByRole("button", { name: "웹캠 끄기" }).click();
  await page.waitForTimeout(500);
  report.webcamOffRestores = await difference(off, await shoot("webcam-body-off-again"));
  report.pageErrors = errors;

  assert.ok(report.webcamBodyChange > 2000, "The webcam pose did not move the actor's upper body.");
  assert.ok(report.webcamOffRestores < report.webcamBodyChange / 5, "Turning the webcam off did not restore the actor's pose.");
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
