import { MOBILE_CAMERA_API, MOBILE_CAMERA_PAGE, mobilePairCodeSchema, mobilePairSettingsSchema, type MobilePairSettings } from "../domain/shot/mobileCaptureProtocol";
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
  action.hidden = false;
};

const route = `${MOBILE_CAMERA_API}/take`;
const code = mobilePairCodeSchema.safeParse(location.hash.slice(1));
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const arSetup = "Open this link in Chrome on an ARCore-capable Android phone with Google Play Services for AR enabled.";

const startupMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === "SecurityError" || error.name === "NotAllowedError") {
      return "Allow camera and AR access in Chrome, then tap Start AR again.";
    }
    if (error.name === "NotSupportedError") {
      return "Chrome couldn't start AR. Check camera permissions and update Google Play Services for AR on an ARCore-capable phone.";
    }
  }
  return error instanceof Error ? error.message : "Couldn't start AR.";
};

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
    message(startupMessage(error));
    button("Start AR", () => void start(xr, settings, authorization));
  }
}

async function connect() {
  action.hidden = true;
  iosApp.hidden = true;
  if (!code.success) return message("Scan a new code from Camera trajectory → Connect phone with QR in the editor.");
  if (!window.isSecureContext) return message("Open a new HTTPS QR link from the editor.");
  message("Connecting to the editor…");
  const authorization = `Bearer ${code.data}`;
  const connection = new AbortController();
  const timeout = window.setTimeout(() => connection.abort(), 12_000);
  let settings: MobilePairSettings;
  try {
    const response = await fetch(route, { headers: { Authorization: authorization }, signal: connection.signal });
    if (response.status === 404) return message("This pairing ended. Keep the editor's Camera trajectory panel open and scan a new QR.");
    if (!response.ok) throw new Error("Couldn't reach the editor.");
    settings = mobilePairSettingsSchema.parse(await response.json());
  } catch {
    message("Couldn't reach the editor. Keep its Camera trajectory panel open and retry, or scan a new QR.");
    button("Retry connection", () => void connect());
    return;
  } finally {
    window.clearTimeout(timeout);
  }
  if (isIOS) {
    if (location.protocol !== "https:" || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(location.hostname)) {
      return message("Use Connect phone with QR in the editor to pair SceneForge Camera on iPhone.");
    }
    const pairingURL = new URL(MOBILE_CAMERA_PAGE, location.origin);
    pairingURL.hash = code.data;
    const handoff = new URL("sceneforge-camera://pair");
    handoff.searchParams.set("link", pairingURL.href);
    iosApp.href = handoff.href;
    iosApp.hidden = false;
    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(pairingURL.href);
        message("Link copied. Open SceneForge Camera from the Home Screen and tap Paste.");
      } catch {
        message("Copy this page’s address from Safari. Open SceneForge Camera from the Home Screen and tap Paste.");
      }
    };
    button("Copy pairing link", () => void copyLink());
    return message("Install SceneForge Camera from Xcode to record on iPhone. If this button can’t open the installed app, copy the pairing link and tap Paste in the app.");
  }
  const xr = navigator.xr;
  if (!xr) return message(arSetup);
  message(`Paired · ${settings.durationFrames} frames at ${settings.fps} fps. Start AR to record.`);
  button("Start AR", () => void start(xr, settings, authorization));
}

void connect();
