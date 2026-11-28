import type { MobilePairSettings } from "../domain/shot/mobileCaptureProtocol";
import type { MobileCameraSession } from "../domain/shot/mobileSession";
import { createMarkerTracker } from "./markerPose";
import { createPhoneTakeRecorder } from "./takeRecorder";

export async function recordMarkerTake({ edgeMeters, preview, settings, onStatus, onReady }: {
  edgeMeters: number;
  preview: HTMLVideoElement;
  settings: MobilePairSettings;
  onStatus: (text: string) => void;
  onReady: (stop: () => void) => void;
}): Promise<MobileCameraSession | undefined> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const tracks = stream.getTracks();
  try {
    preview.srcObject = stream;
    preview.hidden = false;
    await preview.play();
    const canvas = document.createElement("canvas");
    if (!preview.videoWidth || !preview.videoHeight) throw new Error("The camera did not provide a video frame.");
    const scale = Math.min(1, 640 / Math.max(preview.videoWidth, preview.videoHeight));
    canvas.width = Math.round(preview.videoWidth * scale);
    canvas.height = Math.round(preview.videoHeight * scale);
    const pixels = canvas.getContext("2d", { willReadFrequently: true });
    if (!pixels) throw new Error("The browser could not read the camera frames.");
    const tracker = createMarkerTracker(edgeMeters, canvas.width, canvas.height);
    const take = createPhoneTakeRecorder(settings);

    return await new Promise<MobileCameraSession | undefined>((resolve, reject) => {
      let animation = 0;
      let lastVideoTime = -1;
      const cleanup = () => {
        cancelAnimationFrame(animation);
        window.removeEventListener("pagehide", discard);
        for (const track of tracks) track.removeEventListener("ended", finish);
      };
      const discard = () => { cleanup(); resolve(undefined); };
      const finish = () => {
        cleanup();
        const frames = take.frames();
        resolve(frames.length ? { framework: "marker", frames, intrinsics: tracker.intrinsics } : undefined);
      };
      const tick = (now: number) => {
        try {
          if (preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && preview.currentTime !== lastVideoTime) {
            lastVideoTime = preview.currentTime;
            pixels.drawImage(preview, 0, 0, canvas.width, canvas.height);
            const pose = tracker.pose(pixels.getImageData(0, 0, canvas.width, canvas.height));
            const update = take.observe(now, pose ? { trackingState: "tracked", pose } : { trackingState: "lost" });
            if (update.kind === "complete") return finish();
            if (update.kind === "recording") {
              onStatus(`${pose ? "Recording" : "Marker tracking lost"} · ${update.seconds.toFixed(1)} s`);
            }
          }
          animation = requestAnimationFrame(tick);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      window.addEventListener("pagehide", discard, { once: true });
      for (const track of tracks) track.addEventListener("ended", finish, { once: true });
      onStatus("Point at the tracking marker. Recording starts when all four corners are visible.");
      onReady(finish);
      animation = requestAnimationFrame(tick);
    });
  } finally {
    for (const track of tracks) track.stop();
    preview.srcObject = null;
    preview.hidden = true;
  }
}
