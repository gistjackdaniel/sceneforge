import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { mobileCameraTakeCommand } from "../../application/services/mobileCameraTake";
import { MOBILE_CAMERA_API, MOBILE_CAMERA_PAGE, mobilePairSchema, type MobilePair, type MobilePairTransport } from "../../domain/shot/mobileCaptureProtocol";
import { drawTrackingMarker } from "../../domain/shot/mobileMarker";
import type { Shot, ShotCommand } from "../../domain/shot";

const route = `${MOBILE_CAMERA_API}/pair`;
const editorHeaders = ({ code, editorKey }: MobilePair) => ({ Authorization: `Bearer ${code}.${editorKey}` });
const closePair = (pair: MobilePair) => fetch(route, { method: "DELETE", headers: editorHeaders(pair), keepalive: true }).catch(() => undefined);

type Connection = { kind: "idle" } | { kind: "linking" } | { kind: "waiting"; pair: MobilePair };

export function PhoneCameraControls({ shot, disabled, onTake }: {
  shot: Shot;
  disabled: boolean;
  onTake: (command: ShotCommand) => void;
}) {
  const [connection, setConnection] = useState<Connection>({ kind: "idle" });
  const [notice, setNotice] = useState("");
  const startRequest = useRef<AbortController | undefined>(undefined);
  const markerDialog = useRef<HTMLDialogElement>(null);
  const markerCanvas = useRef<HTMLCanvasElement>(null);
  const markerTitleId = useId();
  const pair = connection.kind === "waiting" ? connection.pair : undefined;
  const phone = useMemo(() => {
    if (!pair) return undefined;
    const url = new URL(MOBILE_CAMERA_PAGE, pair.transport === "qr" ? pair.phoneOrigin : window.location.href);
    url.hash = pair.code;
    if (pair.transport === "usb") {
      if (url.hostname === "127.0.0.1" || url.hostname === "[::1]") url.hostname = "localhost";
      return { url: url.href };
    }
    const qr = qrcode(0, "M");
    qr.addData(url.href);
    qr.make();
    return { url: url.href, image: qr.createDataURL(5, 20) };
  }, [pair]);
  const acceptTake = useEffectEvent((session: unknown, livePair: MobilePair) => {
    if (shot.time.fps !== livePair.settings.fps || shot.time.durationFrames !== livePair.settings.durationFrames) {
      throw new Error("The shot clock changed. Pair the phone again.");
    }
    onTake(mobileCameraTakeCommand({ session, shot, capturedAt: new Date().toISOString() }));
    setNotice("Phone take saved. The shot camera is selected.");
  });

  useEffect(() => () => startRequest.current?.abort(), []);

  useEffect(() => {
    if (!pair) return;
    const abort = new AbortController();
    const release = () => { void closePair(pair); };
    let timer: number;
    const poll = async () => {
      try {
        const result = await fetch(route, { headers: editorHeaders(pair), signal: abort.signal });
        if (result.status === 204) {
          timer = window.setTimeout(poll, 750);
          return;
        }
        if (result.status === 404) throw new Error("Pairing ended. Create a new phone link.");
        if (!result.ok) throw new Error("Couldn't receive the phone take.");
        const session: unknown = await result.json();
        if (!abort.signal.aborted) acceptTake(session, pair);
      } catch (error) {
        if (!abort.signal.aborted) setNotice(error instanceof Error ? error.message : "Couldn't receive the phone take.");
      }
      if (!abort.signal.aborted) setConnection({ kind: "idle" });
    };
    void poll();
    window.addEventListener("pagehide", release);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [pair]);

  const createLink = async (transport: MobilePairTransport) => {
    const abort = new AbortController();
    startRequest.current = abort;
    setNotice("");
    setConnection({ kind: "linking" });
    try {
      const result = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fps: shot.time.fps, durationFrames: shot.time.durationFrames, transport }),
        signal: abort.signal,
      });
      if (!result.ok) {
        const problem: unknown = await result.json().catch(() => undefined);
        throw new Error(problem && typeof problem === "object" && "message" in problem && typeof problem.message === "string"
          ? problem.message : "Couldn't create a phone link. Use the SceneForge editor server.");
      }
      const created = mobilePairSchema.parse(await result.json());
      if (!abort.signal.aborted) setConnection({ kind: "waiting", pair: created });
      else void closePair(created);
    } catch (error) {
      if (abort.signal.aborted) return;
      setConnection({ kind: "idle" });
      setNotice(error instanceof Error ? error.message : "Couldn't create a phone link.");
    }
  };

  const cancel = () => {
    startRequest.current?.abort();
    setConnection({ kind: "idle" });
  };

  return <section className="scene-phone-camera" aria-label="Phone camera">
    {phone ? <>
      {phone.image && <img className="scene-phone-qr" src={phone.image} alt="Phone camera pairing QR code" />}
      <p className="scene-note">{phone.image
        ? "Scan with your phone’s camera. Open Chrome on Android or Safari on iPhone. Keep this panel open."
        : "Open the link in Android Chrome using USB port forwarding. Keep this panel open."}</p>
      {phone.image && <>
        <button onClick={() => {
          if (markerCanvas.current) drawTrackingMarker(markerCanvas.current);
          markerDialog.current?.showModal();
        }}>Show tracking marker</button>
        <dialog ref={markerDialog} className="scene-marker-dialog" aria-labelledby={markerTitleId}>
          <h2 id={markerTitleId}>Tracking marker</h2>
          <p>Measure the width of the black square in centimeters. Enter that width in Safari and keep the marker in view as you move the phone.</p>
          <canvas ref={markerCanvas} width={600} height={600} role="img" aria-label="Camera tracking marker" />
          <form method="dialog"><button>Close marker</button></form>
        </dialog>
      </>}
      <label>Phone link<input readOnly value={phone.url} onFocus={(event) => event.target.select()} /></label>
      <button onClick={cancel}>Cancel pairing</button>
    </> : connection.kind === "linking" ? <>
      <p className="scene-note" role="status">Creating phone link…</p>
      <button onClick={cancel}>Cancel pairing</button>
    </> : <>
      <button className="scene-primary" disabled={disabled} onClick={() => void createLink("qr")}>Connect phone with QR</button>
      <p className="scene-note">Uses a temporary Cloudflare HTTPS link for the phone camera.</p>
      <button disabled={disabled} onClick={() => void createLink("usb")}>Connect phone via USB</button>
    </>}
    {notice && <p className="scene-note" role="status">{notice}</p>}
  </section>;
}
