import { MOBILE_CAMERA_API, mobilePairCodeSchema, mobilePairSettingsSchema, type MobilePairSettings } from "../domain/shot/mobileCaptureProtocol";
import type { MobileCameraSession } from "../domain/shot/mobileSession";
import { secondsToFrame } from "../domain/timeline/timecode";

type Sample = MobileCameraSession["frames"][number];
type Intrinsics = NonNullable<MobileCameraSession["intrinsics"]>;

const overlayElement = document.querySelector("#camera-overlay");
const status = document.querySelector("#camera-status");
const actionElement = document.querySelector("#camera-action");
const nativeLink = document.querySelector("#camera-native");
if (!(overlayElement instanceof HTMLElement) || !(status instanceof HTMLElement) || !(actionElement instanceof HTMLButtonElement) || !(nativeLink instanceof HTMLAnchorElement)) {
  throw new Error("Phone camera controls are missing.");
}
const overlay = overlayElement;
const action = actionElement;
const iosApp = nativeLink;

const message = (text: string) => { if (status.textContent !== text) status.textContent = text; };
const button = (label: string, run?: () => void) => {
  action.textContent = label;
  action.disabled = !run;
  action.onclick = run ?? null;
};

const route = `${MOBILE_CAMERA_API}/take`;
const code = mobilePairCodeSchema.safeParse(location.hash.slice(1));
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const viewIntrinsics = (view: XRView, viewport: XRViewport): Intrinsics => {
  const projection = view.projectionMatrix;
  const { width, height } = viewport;
  return {
    imageSize: [width, height],
    fx: projection[0] * width / 2,
    fy: projection[5] * height / 2,
    cx: (1 - projection[8]) * width / 2,
    cy: (1 + projection[9]) * height / 2,
  };
};

async function start(xr: XRSystem, settings: MobilePairSettings, authorization: string) {
  button("Starting AR…");
  let session: XRSession | undefined;
  try {
    session = await xr.requestSession("immersive-ar", { requiredFeatures: ["dom-overlay"], domOverlay: { root: overlay } });
    const gl = document.createElement("canvas").getContext("webgl", { xrCompatible: true, alpha: true });
    if (!gl) throw new Error("This phone could not start WebGL.");
    const layer = new XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: layer });
    const space = await session.requestReferenceSpace("local");
    const active = session;
    const frames = new Map<number, Sample>();
    let intrinsics: Intrinsics | undefined;
    let originNs: number | undefined;
    let lastSample: Sample | undefined;
    let reset = false;
    let ending = false;

    const frameAt = (timestampNs: number, origin: number) => secondsToFrame((timestampNs - origin) / 1e9, settings.fps);
    const markTrackingGap = (sample: Sample, origin: number) => {
      const missingAt = frameAt(sample.timestampNs, origin) + 1;
      if (missingAt < settings.durationFrames) {
        frames.set(missingAt, { ...sample, timestampNs: origin + Math.round(missingAt * 1e9 / settings.fps), trackingState: "lost" });
      }
    };
    const stop = () => {
      if (ending) return;
      ending = true;
      button("Finishing…");
      void active.end();
    };
    const upload = async () => {
      button("Sending take…");
      message(reset ? "Tracking origin reset. Sending the recorded portion…" : "Sending the take to the editor…");
      const body: MobileCameraSession = { framework: "webxr", frames: [...frames.values()], intrinsics };
      try {
        const response = await fetch(route, {
          method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (response.status === 404) {
          message("This pairing ended. Open a new phone link from the editor.");
          button("Pairing ended");
          return;
        }
        if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
        button("Take sent");
        message(reset ? "Partial take sent. The tracking origin reset during recording." : "Take sent. Play the selected take in SceneForge.");
      } catch (error) {
        message(error instanceof Error ? error.message : "Couldn't send the take.");
        button("Retry send", () => void upload());
      }
    };
    active.addEventListener("end", () => {
      if (frames.size > 0) void upload();
      else {
        message("No 6DoF pose was captured. Aim at a well-lit, textured area and try again.");
        button("Start AR", () => void start(xr, settings, authorization));
      }
    }, { once: true });
    space.addEventListener("reset", () => {
      if (originNs !== undefined && lastSample && !ending) {
        markTrackingGap(lastSample, originNs);
        reset = true;
        stop();
      }
    });

    const capture: XRFrameRequestCallback = (timestampMs, frame) => {
      if (ending) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const viewer = frame.getViewerPose(space);
      const view = viewer?.views[0];
      const tracked = view && viewer?.emulatedPosition === false;
      const timestampNs = Math.round(timestampMs * 1e6);
      if (originNs === undefined && tracked) {
        originNs = timestampNs;
        const viewport = layer.getViewport(view);
        if (viewport && viewport.width > 0 && viewport.height > 0) intrinsics = viewIntrinsics(view, viewport);
      }
      if (originNs !== undefined) {
        const frameIndex = frameAt(timestampNs, originNs);
        if (lastSample && timestampNs - lastSample.timestampNs > Math.max(150, 2000 / settings.fps) * 1e6) {
          markTrackingGap(lastSample, originNs);
        }
        if (frameIndex >= settings.durationFrames) return stop();
        const pose = view ? { kind: "matrix" as const, transform: Array.from(view.transform.matrix) } : lastSample?.pose;
        if (pose) {
          lastSample = { timestampNs, pose, trackingState: tracked ? "tracked" : view ? "emulated" : "lost" };
          if (frameIndex !== 0 || !frames.has(0)) frames.set(frameIndex, lastSample);
        }
        message(`${tracked ? "Recording" : "Tracking limited"} · ${((timestampNs - originNs) / 1e9).toFixed(1)} s`);
      }
      active.requestAnimationFrame(capture);
    };
    message("Hold your starting position and aim forward until recording starts.");
    button("Stop and send", stop);
    active.requestAnimationFrame(capture);
  } catch (error) {
    await session?.end().catch(() => undefined);
    message(error instanceof Error ? error.message : "Couldn't start AR.");
    button("Start AR", () => void start(xr, settings, authorization));
  }
}

async function connect() {
  if (!code.success) return message("Open the phone link from SceneForge's Camera trajectory panel.");
  const authorization = `Bearer ${code.data}`;
  const response = await fetch(route, { headers: { Authorization: authorization } });
  if (response.status === 404) return message("This pairing ended. Open a new phone link from the editor.");
  if (!response.ok) throw new Error("Couldn't reach the editor.");
  const settings = mobilePairSettingsSchema.parse(await response.json());
  if (isIOS) {
    action.hidden = true;
    if (location.protocol !== "https:" || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(location.hostname)) {
      return message("Use Connect phone with QR in the editor to pair SceneForge Camera on iPhone.");
    }
    const handoff = new URL("sceneforge-camera://pair");
    handoff.searchParams.set("link", location.href);
    iosApp.href = handoff.href;
    iosApp.hidden = false;
    return message("Open the installed SceneForge Camera app to record this take with ARKit.");
  }
  const xr = navigator.xr;
  if (!window.isSecureContext || !xr || !await xr.isSessionSupported("immersive-ar")) {
    return message("Open the QR link in Chrome on an ARCore-capable Android phone with Google Play Services for AR enabled.");
  }
  message(`Paired · ${settings.durationFrames} frames at ${settings.fps} fps. Start AR to record.`);
  button("Start AR", () => void start(xr, settings, authorization));
}

void connect().catch((error: unknown) => message(error instanceof Error ? error.message : "Couldn't reach the editor."));
