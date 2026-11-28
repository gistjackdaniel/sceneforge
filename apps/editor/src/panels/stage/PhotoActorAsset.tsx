import { useEffect, useRef, useState } from "react";
import { PHOTO_ACTOR_ENDPOINT, PHOTO_ACTOR_IMAGE_MIMES, PHOTO_ACTOR_MAX_IMAGE_BYTES, isPhotoActorImageMime } from "../../domain/worlds/photoActor";
import type { SceneObject } from "../../domain/worlds/sceneObjects";
import { SHOT_WORLD_MAX_BYTES } from "../../domain/worlds/importedShotWorld";
import type { PhotoBody } from "../../infrastructure/connectors/photoHuman";

type PhotoMode = "full-body" | "face";

async function generateFullBody(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(PHOTO_ACTOR_ENDPOINT, { method: "POST", headers: { "Content-Type": file.type }, body: file, signal });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof failure?.error === "string" ? failure.error : "전신 복원 요청을 완료할 수 없습니다.");
  }
  if (response.headers.get("Content-Type") !== "model/gltf-binary" || Number(response.headers.get("Content-Length")) > SHOT_WORLD_MAX_BYTES) {
    throw new Error("전신 복원 서버가 유효한 GLB를 보내지 않았습니다.");
  }
  return response.arrayBuffer();
}

export const PhotoActorAsset = ({ onAdd, disabled }: { onAdd: (actor: SceneObject) => void; disabled: boolean }) => {
  const [mode, setMode] = useState<PhotoMode>("face");
  const [available, setAvailable] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [body, setBody] = useState<PhotoBody | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const check = new AbortController();
    void fetch(PHOTO_ACTOR_ENDPOINT, { signal: check.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (!check.signal.aborted) setAvailable(result?.available === true); })
      .catch(() => { if (!check.signal.aborted) setAvailable(false); });
    return () => { check.abort(); controller.current?.abort(); };
  }, []);

  const generate = async () => {
    if (!photo || disabled || controller.current) return;
    const make = mode === "full-body"
      ? available ? (signal: AbortSignal) => generateFullBody(photo, signal) : undefined
      : body ? async (signal: AbortSignal) => (await import("../../infrastructure/connectors/photoHuman")).generatePhotoHuman(photo, body, signal) : undefined;
    if (!make) return;
    const job = new AbortController();
    controller.current = job;
    setBusy(true);
    setError("");
    try {
      const bytes = await make(job.signal);
      job.signal.throwIfAborted();
      const { importPhotoActor } = await import("../../application/services/importPhotoActor");
      const name = photo.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "사진 액터";
      const actor = await importPhotoActor(bytes, name, job.signal);
      if (!job.signal.aborted) onAdd(actor);
    } catch (cause) {
      if (!job.signal.aborted) setError(cause instanceof Error ? cause.message : "사진에서 3D 사람을 만들지 못했습니다.");
    } finally {
      if (controller.current === job) { controller.current = null; setBusy(false); }
    }
  };

  return <section className="scene-photo-asset" aria-label="사진으로 3D 사람 만들기">
    <h3>사진으로 3D 사람 만들기</h3>
    <p className="scene-note">Kimodo 전신 동작과 웹캠 표정을 연결할 수 있는 액터를 추가합니다.</p>
    <label>생성 방식<select value={mode} disabled={disabled || busy} onChange={(event) => { setMode(event.target.value as PhotoMode); setError(""); }}>
      <option value="face">사진으로 얼굴 맞춤 · HumanForge</option>
      <option value="full-body" disabled={!available}>사진에서 전신 복원 · Pixal3D{available ? "" : " (서버 미연결)"}</option>
    </select></label>
    <p className="scene-note">{mode === "full-body"
      ? "한 사람이 머리부터 발끝까지 보이는 사진을 사용하세요. 연결된 에디터 서버에서 복원합니다."
      : "정면에 가까운 얼굴 사진을 사용하세요. 사진은 브라우저에서 처리하며, 몸과 의상은 기본 에셋을 사용합니다."}</p>
    {mode === "face" && <label>체형<select value={body} disabled={disabled || busy} onChange={(event) => setBody(event.target.value as PhotoBody)}>
      <option value="" disabled>선택하세요</option>
      <option value="male">남성</option>
      <option value="female">여성</option>
    </select></label>}
    <label className="scene-upload">인물 사진<input type="file" accept={PHOTO_ACTOR_IMAGE_MIMES.join(",")} disabled={disabled || busy} onChange={(event) => {
      const file = event.target.files?.[0];
      setError("");
      setPhoto(undefined);
      if (!file) return;
      if (!isPhotoActorImageMime(file.type) || file.size === 0 || file.size > PHOTO_ACTOR_MAX_IMAGE_BYTES) {
        event.target.value = "";
        setError("12 MiB 이하의 PNG, JPEG, WebP 사진을 선택하세요.");
      } else setPhoto(file);
    }} /></label>
    <div className="scene-button-group">
      <button type="button" className="scene-primary" disabled={disabled || busy || !photo || (mode === "face" && !body)} onClick={() => void generate()}>3D 사람 추가</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()}>취소</button>}
    </div>
    {busy && <p className="scene-note" role="status">{mode === "full-body" ? "전신 메시를 복원하고 리깅하는 중…" : "얼굴을 맞추고 리깅된 에셋을 만드는 중…"}</p>}
    {error && <p className="scene-photo-error" role="alert">{error}</p>}
  </section>;
};
