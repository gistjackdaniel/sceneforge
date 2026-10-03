import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import { useWorldGeneration } from "../world-generation/useWorldGeneration";
import { reconstructSceneObject } from "../../infrastructure/connectors/sceneReconstruction";
import type { SceneObject } from "../../domain/worlds/sceneObjects";

export const SceneAssets = ({ onAdd, disabled }: { onAdd: (object: SceneObject, source?: Record<string, unknown>) => void; disabled: boolean }) => {
  const { state: { ui } } = useEditorStore();
  const { registerImageFile } = useWorldGeneration();
  const [uri, setUri] = useState("");
  const [label, setLabel] = useState("New object");
  const [points, setPoints] = useState<Array<{ x: number; y: number; foreground: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const endpoint = import.meta.env.VITE_SCENE_ASSET_URL;
  const draft = ui.worldGenDraft;
  useEffect(() => { setPoints([]); return () => controller.current?.abort(); }, [draft.imageAssetId]);
  const makeObject = (representation: SceneObject["representation"], kind: SceneObject["kind"] = "prop"): SceneObject => ({
    id: `object-${crypto.randomUUID()}`, name: label.trim() || "New object", kind, representation,
    position: [0, kind === "light" ? 2 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: false, color: "#d8d2c4", intensity: 3,
  });
  const reconstruct = async () => {
    if (!endpoint || !draft.imageAssetId || !draft.imageThumbnailUri || busy) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setMessage("");
    const object = makeObject("mesh");
    try {
      const result = await reconstructSceneObject(endpoint, { version: 1, sourceAssetId: draft.imageAssetId, sourceImageUri: draft.imageThumbnailUri,
        objectId: object.id, label: object.name, points, tasks: ["segment_object", "reconstruct_object"] }, abort.signal);
      if (abort.signal.aborted) return;
      onAdd({ ...object, uri: result.meshUri }, { ...result, points });
      setPoints([]); setMessage("복원된 3D 객체를 장면에 추가했습니다.");
    } catch {
      if (!abort.signal.aborted) setMessage("3D 복원에 실패했습니다. 커넥터와 결과 형식을 확인하세요.");
    } finally { if (controller.current === abort) setBusy(false); }
  };
  return <div className="scene-assets">
    <p className="scene-note">원본은 보존하고, 객체마다 편집 가능한 3D 에셋을 만듭니다.</p>
    <label>Object name<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    <div className="scene-button-group">
      <button disabled={disabled} onClick={() => onAdd(makeObject("box"))}>+ Block</button>
      <button disabled={disabled} onClick={() => onAdd(makeObject("sphere"))}>+ Sphere</button>
      <button disabled={disabled} onClick={() => onAdd({ ...makeObject("marker", "light"), name: "Point light" })}>+ Light</button>
    </div>
    <details><summary>Import 3D asset</summary>
      <label>GLB URL<input placeholder="/assets/object.glb" value={uri} onChange={(event) => setUri(event.target.value)} /></label>
      <button disabled={disabled || !/^(https?:\/\/|\/)[^?#]+\.glb(?:[?#].*)?$/i.test(uri)} onClick={() => { onAdd({ ...makeObject("mesh"), uri }); setUri(""); }}>Place asset</button>
    </details>
    <div className="scene-section-label">IMAGE → OBJECT</div>
    <label className="scene-upload">Choose source image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || disabled} onChange={(event) => {
      const file = event.target.files?.[0]; if (file) void registerImageFile(file).catch(() => setMessage("이미지를 읽을 수 없습니다."));
    }} /></label>
    {draft.imageThumbnailUri && <>
      <div className="scene-source-image" onPointerDown={(event) => {
        if (busy || disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        setPoints((previous) => [...previous, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, foreground: !event.shiftKey }]);
      }}>
        <img src={draft.imageThumbnailUri} alt="Source: click the object to reconstruct" draggable={false} />
        {points.map((point, index) => <span key={index} className={point.foreground ? "is-positive" : "is-negative"} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>{point.foreground ? "+" : "−"}</span>)}
      </div>
      <p className="scene-note">클릭: 포함 · Shift 클릭: 제외. 점은 분할 요청이며 마스크가 아닙니다.</p>
      <button disabled={!points.length || busy} onClick={() => setPoints([])}>Clear selection</button>
    </>}
    <button className="scene-primary" disabled={disabled || !endpoint || !points.length || busy} onClick={() => void reconstruct()}>{busy ? "Reconstructing…" : "Reconstruct 3D"}</button>
    {busy && <button onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel</button>}
    <p className="scene-note">{endpoint ? "분할 → 3D 복원 커넥터 연결됨. 결과를 검증한 뒤 배치합니다." : "SAM 계열 분할 + 3D 복원 커넥터 미연결. 블록 배치와 GLB 가져오기는 바로 사용할 수 있습니다."}</p>
    {message && <p role="status" className="scene-note">{message}</p>}
  </div>;
};
