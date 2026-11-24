import { useEffect, useEffectEvent, useRef, useState } from "react";
import { mobileCameraTakeCommand } from "../../application/services/mobileCameraTake";
import { MOBILE_CAMERA_API, MOBILE_CAMERA_PAGE, mobilePairSchema, type MobilePair } from "../../domain/shot/mobileCaptureProtocol";
import type { Shot, ShotCommand } from "../../domain/shot";

const route = `${MOBILE_CAMERA_API}/pair`;
const editorHeaders = ({ code, editorKey }: MobilePair) => ({ Authorization: `Bearer ${code}.${editorKey}` });
const closePair = (pair: MobilePair) => fetch(route, { method: "DELETE", headers: editorHeaders(pair) }).catch(() => undefined);

type Connection = { kind: "idle" } | { kind: "linking" } | { kind: "waiting"; pair: MobilePair };

export function PhoneCameraControls({ shot, disabled, onTake }: {
  shot: Shot;
  disabled: boolean;
  onTake: (command: ShotCommand) => void;
}) {
  const [connection, setConnection] = useState<Connection>({ kind: "idle" });
  const [notice, setNotice] = useState("");
  const startRequest = useRef<AbortController | undefined>(undefined);
  const pair = connection.kind === "waiting" ? connection.pair : undefined;
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
    return () => {
      abort.abort();
      window.clearTimeout(timer);
      void closePair(pair);
    };
  }, [pair]);

  const createLink = async () => {
    const abort = new AbortController();
    startRequest.current = abort;
    setNotice("");
    setConnection({ kind: "linking" });
    try {
      const result = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fps: shot.time.fps, durationFrames: shot.time.durationFrames }),
        signal: abort.signal,
      });
      if (!result.ok) throw new Error("Couldn't create a phone link. Use the SceneForge editor server.");
      const created = mobilePairSchema.parse(await result.json());
      if (!abort.signal.aborted) setConnection({ kind: "waiting", pair: created });
      else void closePair(created);
    } catch (error) {
      if (abort.signal.aborted) return;
      setConnection({ kind: "idle" });
      setNotice(error instanceof Error ? error.message : "Couldn't create a phone link.");
    }
  };

  const phoneUrl = pair ? new URL(MOBILE_CAMERA_PAGE, window.location.href) : undefined;
  if (phoneUrl && pair) {
    phoneUrl.hash = pair.code;
    if (phoneUrl.hostname === "127.0.0.1" || phoneUrl.hostname === "[::1]") phoneUrl.hostname = "localhost";
  }

  return <section className="scene-phone-camera" aria-label="Phone camera">
    {phoneUrl ? <>
      <label>Phone link<input readOnly value={phoneUrl.href} onFocus={(event) => event.target.select()} /></label>
      <p className="scene-note">Open this link in Android Chrome using USB port forwarding. Keep this panel open until the take arrives.</p>
      <button onClick={() => setConnection({ kind: "idle" })}>Cancel pairing</button>
    </> : <button disabled={disabled || connection.kind === "linking"} onClick={() => void createLink()}>Connect phone camera</button>}
    {notice && <p className="scene-note" role="status">{notice}</p>}
  </section>;
}
