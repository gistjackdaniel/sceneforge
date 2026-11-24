import { useEffect, useRef, useState } from "react";
import { selectedTake, type Shot } from "../../domain/shot";

type ExportResult = { kind: "archive"; blob: Blob } | { kind: "error"; message: string };

export function RenderPassExport({ shot, aspect, disabled }: { shot: Shot; aspect: number; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef<Worker | undefined>(undefined);
  useEffect(() => () => running.current?.terminate(), []);

  const run = () => {
    const worker = new Worker(new URL("../../application/services/shotPassArchive.worker.ts", import.meta.url), { type: "module" });
    running.current = worker;
    setBusy(true);
    setNotice("Rendering the saved take…");
    const done = (message: string) => {
      worker.terminate();
      running.current = undefined;
      setBusy(false);
      setNotice(message);
    };
    worker.onmessage = ({ data }: MessageEvent<ExportResult>) => {
      if (data.kind === "error") return done(data.message);
      const url = URL.createObjectURL(data.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${shot.id}-passes.tar`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      done("Render passes downloaded.");
    };
    worker.onerror = () => done("Couldn't start the render pass worker.");
    worker.postMessage({ shot, aspect });
  };

  return <>
    <button disabled={disabled || busy || !selectedTake(shot)} onClick={run}>Export render passes</button>
    <p className="scene-note">Reference geometry · RGB, depth, normals, world position, instance ID, and surface tracking.</p>
    {notice && <p role="status" className="scene-note">{notice}</p>}
  </>;
}
