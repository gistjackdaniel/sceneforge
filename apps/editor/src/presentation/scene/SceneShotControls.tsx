import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { importShotWorld } from "../../application/services/importShotWorld";
import { generateKimodoMotion, loadKimodoMotion } from "../../application/services/kimodoMotion";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import type { DomainCommand } from "../../application/commands";
import type { OutputAspectPreset } from "../../domain/rendering";
import { PHASE1_ACTORS, PHASE1_MOTIONS, PHASE1_SHOT_ID } from "../../domain/sceneAuthoring/phase1Demo";
import { compareMotionEdit, reviewMotionState, type MotionReviewState } from "../../domain/sceneAuthoring/reviewMotionEdit";
import type { SomaMotion } from "../../domain/sceneAuthoring/somaMotion";
import { draftFromSource, draftRequest, draftWindow, emptyDraft, placementAt, setDraftWindow, setSegmentPrompt } from "../../domain/sceneAuthoring/kimodoDraft";
import { motionConditionGraph, motionSpanAt, type MotionSource } from "../../domain/shot/motionConditions";
import { prepareModelInput } from "../../domain/shot";
import type { PosedSubject, Shot, ShotCommand } from "../../domain/shot/types";
import type { KimodoEditor } from "../../panels/stage/KimodoTimeline";
import { resolveShotWorldRevision } from "../../domain/worlds/importedShotWorld";
import type { WorldAsset } from "../../domain/worlds/types";
import { WebcamFaceControl } from "./faceControl";
import type { LiveFaceFrame } from "./faceRig";

type ActorSupport = { body: boolean; face: boolean };

interface SceneShotControlsProps {
  shot: Shot;
  world?: WorldAsset;
  aspect: OutputAspectPreset;
  frame: number;
  active: boolean;
  ready: boolean;
  motion: ReturnType<typeof useShotMotion>;
  support: ReadonlyMap<string, ActorSupport>;
  liveFace: RefObject<LiveFaceFrame | null>;
  selectedId: string;
  /** The prompts and waypoints being directed for the selected actor; the timeline edits the same draft. */
  kimodo?: KimodoEditor;
  onKimodo: (editor: KimodoEditor) => void;
  onCommand: (command: DomainCommand) => void;
  onPause: () => void;
  onClose: () => void;
}

const downloadJson = (name: string, data: unknown) => {
  const uri = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.download = name;
  link.href = uri;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(uri), 1000);
};

export const useShotMotion = (shot: Shot | undefined) => {
  const [clips, setClips] = useState<ReadonlyMap<string, SomaMotion>>(() => new Map());
  const [clipError, setClipError] = useState("");
  const graph = useMemo(() => shot && motionConditionGraph(shot), [shot]);
  const allClips = Object.keys(graph?.sources ?? {}).every((id) => clips.has(id));
  useEffect(() => {
    const controller = new AbortController();
    const sources = Object.entries(graph?.sources ?? {}).filter(([id]) => !clips.has(id));
    setClipError("");
    if (sources.length) void Promise.all(sources.map(async ([id, source]) => [id, await loadKimodoMotion(source, controller.signal)] as const)).then((loaded) => {
      if (!controller.signal.aborted) setClips((previous) => new Map([...previous, ...loaded]));
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("샷 모션 불러오기 실패", cause);
      setClipError("샷 모션을 불러오지 못했습니다.");
    });
    return () => controller.abort();
  }, [graph, clips]);
  return { graph, clips, clipError, allClips };
};

export const SceneShotControls = ({ shot, world, aspect, frame, active, ready, motion, support, liveFace, selectedId, kimodo, onKimodo, onCommand, onPause, onClose }: SceneShotControlsProps) => {
  const demo = shot.id === PHASE1_SHOT_ID;
  const actors = shot.subjects.filter((item): item is PosedSubject => item.kind === "human" && item.representation === "mesh");
  const [selected, setSelected] = useState(demo ? PHASE1_ACTORS.b : "");
  const actor = actors.find((item) => item.id === selected) ?? actors[0];
  const [worldUrl, setWorldUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [baseline, setBaseline] = useState<MotionReviewState>();
  const request = useRef<AbortController | null>(null);
  const { graph, clips, clipError, allClips } = motion;
  const pinned = shot.environment?.revisionId;
  const environment = environmentFromWorld(world, pinned);
  const review = useMemo(() => demo && allClips && ready ? reviewMotionState(shot, world, clips) : undefined, [demo, allClips, ready, shot, world, clips]);
  const checks = baseline && review ? compareMotionEdit(baseline, review) : undefined;
  const activeSpan = actor && motionSpanAt(graph, actor.id, frame);
  const actorSupport = actor && support.get(actor.id);
  const shotCommand = (command: ShotCommand) => onCommand({ type: "SHOT", command });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (support.has(selectedId)) setSelected(selectedId); }, [selectedId, support.has(selectedId)]);
  // A newly chosen actor starts from the prompts and waypoints of the motion it plays, or from an empty draft.
  useEffect(() => {
    if (!actor || kimodo?.subjectId === actor.id) return;
    const spans = graph?.spans.filter((span) => span.subjectId === actor.id) ?? [];
    const span = motionSpanAt(graph, actor.id, frame) ?? spans[spans.length - 1];
    const draft = span && graph
      ? draftFromSource(graph.sources[span.sourceId], span, placementAt(actor, span.startFrame))
      : emptyDraft(0, shot.time.durationFrames);
    onKimodo({ subjectId: actor.id, draft, segment: 0 });
  }, [actor?.id, kimodo?.subjectId, graph]);

  const editor = kimodo?.subjectId === actor?.id ? kimodo : undefined;
  const range = editor && draftWindow(editor.draft);
  const segment = editor?.draft.segments[editor.segment];
  const built = editor && actor ? draftRequest(editor.draft, placementAt(actor, range?.startFrame ?? 0)) : undefined;
  const blocker = built && "blocker" in built ? built.blocker : undefined;

  const run = async (message: string, work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(message);
    setError("");
    try {
      await work(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error(message, cause);
        setError(cause instanceof Error && !(cause instanceof SyntaxError) ? cause.message : "요청을 완료할 수 없습니다.");
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) setBusy("");
    }
  };

  const changeMotion = (subjectId: string, source: MotionSource, startFrame: number, endFrame: number) => {
    onPause();
    if (!baseline && review) setBaseline(review);
    shotCommand({ type: "SET_TIMELINE_MOTION", shotId: shot.id, edits: [{ subjectId, source, startFrame, endFrame }] });
  };
  const importBackground = (source: File | string) => void run("배경을 가져오는 중", async (signal) => {
    const name = typeof source === "string" ? "가져온 배경" : source.name.replace(/\.glb$/i, "").slice(0, 120);
    const imported = await importShotWorld(source, { name, signal });
    onCommand({ type: "REGISTER_SHOT_WORLD", shotId: shot.id, worldId: world?.id ?? `world-${crypto.randomUUID()}`, imported });
  });
  const versions = world?.versions?.flatMap(({ jobId, version }) => {
    const revision = resolveShotWorldRevision(world, jobId);
    return revision ? [{ jobId, version, name: revision.name }] : [];
  }) ?? [];
  return <aside className="production-controls" aria-label="샷 편집" data-ready={ready && allClips} hidden={!active}>
      <div className="scene-drawer-heading"><strong>샷 편집</strong><button onClick={onClose}>닫기</button></div>
      <div className="production-section">
        <label>액터<select aria-label="모션 액터" value={actor?.id ?? ""} onChange={(event) => setSelected(event.target.value)}>
          {actors.length === 0 && <option value="">리깅된 액터를 추가하세요</option>}
          {actors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        {actor?.kind === "human" && <small>{actor.instanceId ?? actor.id}</small>}
        <p>{activeSpan && graph ? graph.sources[activeSpan.sourceId].prompt : "이 프레임에 연결된 Kimodo 모션이 없습니다."}</p>
        {demo && <div className="production-row">
          <button disabled={!ready || !allClips || Boolean(busy)} onClick={() => changeMotion(PHASE1_ACTORS.b, PHASE1_MOTIONS.wave, 0, 120)}>B 손 흔들기</button>
          <button disabled={!ready || !allClips || Boolean(busy)} onClick={() => changeMotion(PHASE1_ACTORS.b, PHASE1_MOTIONS.bow, 0, 120)}>B 인사하기</button>
        </div>}
        <form className="production-generation" onSubmit={(event) => {
          event.preventDefault();
          if (!actor || !actorSupport?.body || !built || "blocker" in built) return;
          void run("Kimodo 모션 생성 중", async (signal) => {
            const source = await generateKimodoMotion(built.request, signal);
            if (!signal.aborted) changeMotion(actor.id, source, built.startFrame, built.endFrame);
          });
        }}>
          <label>Kimodo 지시<input value={segment?.prompt ?? ""} maxLength={500} placeholder="A person turns and waves" required disabled={!editor}
            onChange={(event) => editor && onKimodo({ ...editor, draft: setSegmentPrompt(editor.draft, editor.segment, event.target.value) })} /></label>
          {editor && editor.draft.segments.length > 1 && <small>타임라인에서 고른 프롬프트 {editor.segment + 1}/{editor.draft.segments.length}를 고칩니다.</small>}
          <div className="production-row">
            <label>시작 프레임<input type="number" min={0} max={shot.time.durationFrames - 1} value={range?.startFrame ?? 0} disabled={!editor}
              onChange={(event) => editor && range && onKimodo({ ...editor, draft: setDraftWindow(editor.draft, Number(event.target.value), range.endFrame) })} /></label>
            <label>끝 프레임 미포함<input type="number" min={(range?.startFrame ?? 0) + 1} max={shot.time.durationFrames} value={range?.endFrame ?? shot.time.durationFrames} disabled={!editor}
              onChange={(event) => editor && range && onKimodo({ ...editor, draft: setDraftWindow(editor.draft, range.startFrame, Number(event.target.value)) })} /></label>
          </div>
          {editor && editor.draft.waypoints.length > 0 && <small>웨이포인트 {editor.draft.waypoints.length}개를 따라 걷습니다.</small>}
          <button type="submit" title={blocker} disabled={!actor || actor.locked || !actorSupport?.body || !built || Boolean(blocker) || Boolean(busy)}>모션 생성 및 적용</button>
          {actor && ready && actorSupport && !actorSupport.body && <small>이 액터에서 SOMA에 대응되는 몸통 본을 찾지 못했습니다.</small>}
        </form>
        {active && actor && <WebcamFaceControl subjectId={actor.id} available={Boolean(actorSupport?.face)} bodyAvailable={Boolean(actorSupport?.body)} liveFace={liveFace} />}
      </div>
      <div className="production-section">
        <label>샷 모션 버전<select aria-label="샷 모션 버전" value={shot.headRevisionId ?? ""} onChange={(event) => shotCommand({ type: "REVERT_SHOT_REVISION", shotId: shot.id, revisionId: event.target.value })}>
          <option value="" disabled>버전 없음</option>
          {shot.revisions?.map((item, index) => <option value={item.id} key={item.id}>v{index + 1}</option>)}
        </select></label>
        <details><summary>3D 배경 가져오기</summary>
          <label>GLB 파일<input type="file" accept=".glb,model/gltf-binary" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) importBackground(file); event.target.value = ""; }} /></label>
          <form onSubmit={(event) => { event.preventDefault(); if (worldUrl.trim()) importBackground(worldUrl.trim()); }}>
            <label>GLB URL<input type="url" value={worldUrl} onChange={(event) => setWorldUrl(event.target.value)} /></label><button disabled={Boolean(busy) || !worldUrl}>URL 가져오기</button>
          </form>
        </details>
        {world && versions.length > 0 && <label>배경 버전<select value={pinned ?? ""} onChange={(event) => onCommand({ type: "PIN_SHOT_WORLD", shotId: shot.id, worldId: world.id, revisionId: event.target.value })}>
          <option value="" disabled>버전 없음</option>{versions.map((item) => <option key={item.jobId} value={item.jobId}>{item.name} v{item.version}</option>)}
        </select></label>}
        <button onClick={() => {
          const prepared = prepareModelInput(shot, environment, aspect);
          if (prepared.ok) downloadJson(`${shot.id}.conditions.json`, prepared.input);
          else setError(prepared.blocker.message);
        }}>생성 조건 내보내기</button>
        {demo && <button onClick={() => { if (review) downloadJson(`${shot.id}.state.json`, review); }} disabled={!review}>검증 상태 내보내기</button>}
      </div>
      {checks && <ul className="production-checks" aria-label="3D 상태 비교">
        <li data-pass={checks.actorBChanged}>{checks.actorBChanged ? "B 동작 변경" : "B 동작 동일"}</li>
        <li data-pass={checks.camera}>카메라 {checks.camera ? "유지" : "변경"}</li>
        <li data-pass={checks.background}>배경 버전 {checks.background ? "유지" : "변경"}</li>
        <li data-pass={checks.actorARoot}>A 원본 루트 모션 {checks.actorARoot ? "유지" : "변경"}</li>
      </ul>}
      {busy && <div className="production-row" role="status">{busy}<button onClick={() => { request.current?.abort(); setBusy(""); }}>취소</button></div>}
      {(clipError || error) && <p role="alert">{clipError || error}</p>}
  </aside>;
};
