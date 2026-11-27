import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addSegment, removeSegment, removeWaypoint, resizeSegment, retimeWaypoint, setSegmentPrompt, type KimodoDraft,
} from "../../domain/sceneAuthoring/kimodoDraft";
import { KIMODO_FPS } from "../../domain/sceneAuthoring/somaMotion";
import type { ArdyStatus, SteerKey, Steering } from "./useArdyLive";
import "./kimodoTimeline.css";

/** The Kimodo prompts and waypoints being directed for one actor, and the prompt the form edits. */
export type KimodoEditor = { subjectId: string; draft: KimodoDraft; segment: number };

/** ARDY live steering of the same actor, controlled from the timeline's tools and the arrow keys. */
export type LiveSteering = {
  status: ArdyStatus;
  steering: Steering;
  onStart: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onSteer: (key: SteerKey) => void;
};

const arrows: Record<string, SteerKey> = { ArrowUp: "faster", ArrowDown: "slower", ArrowLeft: "left", ArrowRight: "right" };

interface KimodoTimelineProps {
  editor: KimodoEditor;
  duration: number;
  fps: number;
  frame: number;
  disabled: boolean;
  waypointMode: boolean;
  onWaypointMode: (on: boolean) => void;
  onChange: (editor: KimodoEditor) => void;
  onScrub: (frame: number) => void;
  onPlay: () => void;
  live: LiveSteering;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Kimodo's timeline for the selected actor. Click empty Prompts space to add a prompt, double-click one to edit it,
 * drag its right edge to resize it, and right-click it to delete it. Waypoints come from clicking the ground in
 * waypoint mode (P); drag one to retime it and right-click it to delete it. Space plays and the arrow keys step.
 */
export const KimodoTimeline = ({ editor, duration, fps, frame, disabled, waypointMode, onWaypointMode, onChange, onScrub, onPlay, live }: KimodoTimelineProps) => {
  const ruler = useRef<HTMLDivElement>(null);
  const latest = useRef(editor);
  latest.current = editor;
  const keys = useRef({ frame, disabled, waypointMode, onWaypointMode, onScrub, onPlay, live });
  keys.current = { frame, disabled, waypointMode, onWaypointMode, onScrub, onPlay, live };
  const [editing, setEditing] = useState<number>();
  const { draft } = editor;
  const at = (value: number) => `${(value / duration) * 100}%`;
  const frameAt = (clientX: number) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(duration, Math.round(((clientX - rect.left) / rect.width) * duration)));
  };
  const update = (next: KimodoDraft, segment = latest.current.segment) =>
    onChange({ ...latest.current, draft: next, segment: Math.min(segment, next.segments.length - 1) });
  const drag = (event: ReactPointerEvent, apply: (value: number) => void) => {
    if (disabled || event.button !== 0) return;
    const move = (moved: PointerEvent) => apply(frameAt(moved.clientX));
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
  };

  // Kimodo's keys: P places waypoints, Space plays or pauses, and the arrow keys step one frame.
  // While ARDY steers the actor, the arrow keys set its speed and direction instead, as in ARDY's demo.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const current = keys.current;
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (current.live.status.kind === "live" && arrows[event.key]) {
        event.preventDefault();
        current.live.onSteer(arrows[event.key]);
      } else if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) current.onPlay();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        current.onScrub(Math.max(0, Math.min(duration - 1, current.frame + (event.key === "ArrowLeft" ? -1 : 1))));
      } else if (event.key.toLowerCase() === "p" && !event.repeat && !current.disabled) {
        event.preventDefault();
        current.onWaypointMode(!current.waypointMode);
      }
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [duration]);

  const step = duration > 180 ? 30 : 10;
  const ticks = Array.from({ length: Math.floor((duration - 1) / step) + 1 }, (_, index) => index * step);
  const playhead = <span className="kimodo-playhead" style={{ left: at(frame) }} />;
  return <section className="kimodo-timeline" aria-label="Kimodo 타임라인">
    <div className="kimodo-timeline-tools">
      <button type="button" aria-pressed={waypointMode} disabled={disabled} onClick={() => onWaypointMode(!waypointMode)}>웨이포인트 모드 (P)</button>
      <button type="button" disabled={disabled || draft.waypoints.length === 0} onClick={() => update({ ...draft, waypoints: [] })}>웨이포인트 지우기</button>
      {waypointMode && <small>바닥을 클릭하면 액터가 걸어갈 지점이 걷는 속도에 맞춘 프레임에 추가됩니다.</small>}
      {live.status.kind === "live" ? <>
        <button type="button" onClick={live.onSave}>샷에 저장하고 끝내기</button>
        <button type="button" onClick={live.onDiscard}>실시간 조종 끝내기</button>
        <small role="status">
          ARDY 조종 중 · 속도 {live.steering.speed.toFixed(1)} m/s · 방향 {Math.round((live.steering.angle * 180) / Math.PI)}° · ↑/↓ 속도, ←/→ 방향
          · 저장하면 마지막 {(live.status.keep / KIMODO_FPS).toFixed(1)}초가 샷에 들어갑니다
        </small>
      </> : <>
        <button type="button" disabled={disabled || live.status.kind === "starting" || live.status.kind === "saving"} onClick={live.onStart}>실시간 조종 (ARDY)</button>
        {live.status.kind === "starting" && <small role="status">ARDY를 준비하는 중입니다. 처음에는 텍스트 인코더를 불러오느라 1~2분 걸립니다.</small>}
        {live.status.kind === "saving" && <small role="status">실시간 모션을 샷에 저장하는 중입니다.</small>}
        {live.status.kind === "error" && <small role="alert">{live.status.message}</small>}
      </>}
    </div>
    <div className="kimodo-timeline-grid">
      <span className="kimodo-track-label" />
      <div className="kimodo-ruler" ref={ruler} onPointerDown={(event) => onScrub(Math.min(duration - 1, frameAt(event.clientX)))}>
        {ticks.map((tick) => <span className="kimodo-tick" key={tick} style={{ left: at(tick) }}>{tick}</span>)}
        {playhead}
      </div>
      <span className="kimodo-track-label">Prompts</span>
      <div className="kimodo-track" aria-label="Prompts 트랙" onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => {
        if (disabled || event.target !== event.currentTarget || event.button !== 0) return;
        // Keep the mouse events that follow from moving focus off the new prompt's text field.
        event.preventDefault();
        const next = addSegment(draft, frameAt(event.clientX), duration);
        if (next !== draft) {
          update(next, next.segments.length - 1);
          setEditing(next.segments.length - 1);
        }
      }}>
        {draft.segments.map((segment, index) => <div key={index} role="button" tabIndex={0}
          className={`kimodo-prompt ${index === editor.segment ? "is-selected" : ""}`}
          style={{ left: at(segment.startFrame), width: at(segment.endFrame - segment.startFrame) }}
          aria-label={`프롬프트 ${index + 1}: ${segment.prompt || "지시 없음"}`}
          onPointerDown={(event) => { event.stopPropagation(); if (index !== editor.segment) onChange({ ...editor, segment: index }); }}
          onDoubleClick={() => { if (!disabled) setEditing(index); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !disabled && editing !== index) setEditing(index); }}
          onContextMenu={(event) => { event.preventDefault(); if (!disabled) update(removeSegment(draft, index), Math.max(0, index - 1)); }}>
          <span className="kimodo-prompt-length">{((segment.endFrame - segment.startFrame) / fps).toFixed(1)} s</span>
          {editing === index
            ? <input autoFocus defaultValue={segment.prompt} maxLength={500} aria-label={`프롬프트 ${index + 1} 지시`}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={(event) => { update(setSegmentPrompt(latest.current.draft, index, event.target.value)); setEditing(undefined); }}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); }} />
            : <span className={`kimodo-prompt-text ${segment.prompt ? "" : "is-empty"}`}>{segment.prompt || "더블클릭해 지시 입력"}</span>}
          <span className="kimodo-prompt-edge" aria-hidden onPointerDown={(event) => {
            event.stopPropagation();
            drag(event, (value) => update(resizeSegment(latest.current.draft, index, value, duration)));
          }} />
        </div>)}
        {playhead}
      </div>
      <span className="kimodo-track-label">2D Root</span>
      <div className="kimodo-track" aria-label="2D Root 트랙" onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => {
        if (event.target === event.currentTarget) onScrub(Math.min(duration - 1, frameAt(event.clientX)));
      }}>
        {draft.waypoints.map((point, index) => <button type="button" key={index} className="kimodo-waypoint"
          style={{ left: at(point.frame) }} aria-label={`2D Root @ ${point.frame}`} title={`2D Root @ ${point.frame}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            onScrub(Math.min(duration - 1, point.frame));
            drag(event, (value) => update(retimeWaypoint(latest.current.draft, index, value)));
          }}
          onContextMenu={(event) => { event.preventDefault(); if (!disabled) update(removeWaypoint(draft, index)); }} />)}
        {playhead}
      </div>
    </div>
  </section>;
};
