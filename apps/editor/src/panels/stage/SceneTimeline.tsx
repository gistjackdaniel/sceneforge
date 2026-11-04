import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SceneIcon } from "./SceneIcon";

export interface SceneTrackRow {
  id: string;
  name: string;
  frames: number[];
}

export interface SceneTakeOption {
  id: string;
  name: string;
  keyCount: number;
  source: "record" | "manual";
}

const frameAtClientX = (clientX: number, bounds: DOMRect, end: number): number =>
  Math.round(Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width))) * end);

const framesInRange = (frames: number[], a: number, b: number): number[] => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return frames.filter((frame) => frame >= lo && frame <= hi);
};

const framesNearClientX = (
  frames: number[],
  clientX: number,
  bounds: DOMRect,
  end: number,
  hitPx = 8,
): number[] =>
  frames.filter((key) => {
    const x = (key / end) * bounds.width;
    return Math.abs(x - (clientX - bounds.left)) <= hitPx;
  });

export const SceneTimeline = ({
  tracks,
  activeId,
  frame,
  duration,
  fps,
  playing,
  takeRecording,
  takes,
  activeTakeId,
  selectedFrames,
  onSelect,
  onScrub,
  onPlay,
  onRecord,
  onSelectTake,
  onDeleteTake,
  onKey,
  onDelete,
  onSelectedFramesChange,
  disabled,
}: {
  tracks: SceneTrackRow[];
  activeId: string;
  frame: number;
  duration: number;
  fps: number;
  playing: boolean;
  takeRecording: boolean;
  takes: SceneTakeOption[];
  activeTakeId?: string;
  selectedFrames: number[];
  onSelect: (id: string) => void;
  onScrub: (frame: number) => void;
  onPlay: () => void;
  onRecord: () => void;
  onSelectTake: (takeId: string) => void;
  onDeleteTake: (takeId: string) => void;
  onKey: () => void;
  onDelete: () => void;
  onSelectedFramesChange: (frames: number[]) => void;
  disabled: boolean;
}) => {
  const end = Math.max(1, duration - 1);
  const activeTrack = tracks.find((track) => track.id === activeId);
  const occupied = Boolean(activeTrack?.frames.includes(frame));
  const selectedSet = new Set(selectedFrames);
  const canDelete = !disabled && !playing && !takeRecording && (selectedFrames.length > 0 || occupied);
  const [marquee, setMarquee] = useState<{ trackId: string; left: number; right: number } | null>(null);
  const dragRef = useRef<{
    trackId: string;
    lane: HTMLElement;
    startX: number;
    startFrame: number;
    moved: boolean;
    pointerId: number;
    additive: boolean;
  } | null>(null);

  const beginLaneDrag = (event: ReactPointerEvent<HTMLDivElement>, track: SceneTrackRow) => {
    if (disabled || playing || takeRecording || event.button !== 0) {
      return;
    }
    const lane = event.currentTarget;
    const bounds = lane.getBoundingClientRect();
    const startFrame = frameAtClientX(event.clientX, bounds, end);
    onSelect(track.id);
    dragRef.current = {
      trackId: track.id,
      lane,
      startX: event.clientX,
      startFrame,
      moved: false,
      pointerId: event.pointerId,
      additive: event.shiftKey,
    };
    lane.setPointerCapture(event.pointerId);
    setMarquee({ trackId: track.id, left: event.clientX - bounds.left, right: event.clientX - bounds.left });
  };

  const moveLaneDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const bounds = drag.lane.getBoundingClientRect();
    const currentFrame = frameAtClientX(event.clientX, bounds, end);
    if (Math.abs(event.clientX - drag.startX) > 3) {
      drag.moved = true;
    }
    setMarquee({
      trackId: drag.trackId,
      left: Math.min(drag.startX, event.clientX) - bounds.left,
      right: Math.max(drag.startX, event.clientX) - bounds.left,
    });
    if (drag.moved) {
      const track = tracks.find((item) => item.id === drag.trackId);
      onSelectedFramesChange(framesInRange(track?.frames ?? [], drag.startFrame, currentFrame));
    }
  };

  const endLaneDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const bounds = drag.lane.getBoundingClientRect();
    const currentFrame = frameAtClientX(event.clientX, bounds, end);
    if (drag.lane.hasPointerCapture(event.pointerId)) {
      drag.lane.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setMarquee(null);
    const track = tracks.find((item) => item.id === drag.trackId);
    const keys = track?.frames ?? [];
    if (!drag.moved) {
      const hit = framesNearClientX(keys, event.clientX, bounds, end);
      if (hit.length > 0) {
        const primary = hit.reduce((best, item) =>
          Math.abs(item - currentFrame) < Math.abs(best - currentFrame) ? item : best,
        );
        if (drag.additive) {
          const next = selectedSet.has(primary)
            ? selectedFrames.filter((item) => item !== primary)
            : [...selectedFrames, primary].sort((a, b) => a - b);
          onSelectedFramesChange(next);
        } else {
          onSelectedFramesChange([primary]);
        }
        onScrub(primary);
        return;
      }
      onSelectedFramesChange([]);
      onScrub(currentFrame);
      return;
    }
    const next = framesInRange(keys, drag.startFrame, currentFrame);
    onSelectedFramesChange(next);
    if (next.length > 0) {
      onScrub(next[0]);
    }
  };

  return (
    <section className="scene-timeline" aria-label="Shot motion tracks">
      <div className="scene-transport">
        <button
          aria-label={playing && !takeRecording ? "Pause preview" : "Play selected take"}
          title="Preview the selected take. Does not write keyframes."
          onClick={onPlay}
          disabled={disabled || takeRecording}
        >
          <SceneIcon name={playing && !takeRecording ? "pause" : "play"} />
        </button>
        <button
          className={takeRecording ? "is-recording" : ""}
          aria-label={takeRecording ? "Stop recording take" : "Record camera take"}
          aria-pressed={takeRecording}
          title={takeRecording ? "Stop and save as a new take" : "Record every frame into a new take"}
          onClick={onRecord}
          disabled={disabled || (playing && !takeRecording)}
        >
          <SceneIcon name={takeRecording ? "pause" : "camera"} />
          {takeRecording ? "Stop" : "Record"}
        </button>
        <output>
          {(frame / fps).toFixed(2)} <span>/ {(duration / fps).toFixed(2)} s</span>
        </output>
        {takeRecording && <span className="scene-selection-count">Recording take…</span>}
        {!takeRecording && selectedFrames.length > 0 && (
          <span className="scene-selection-count">{selectedFrames.length} selected</span>
        )}
        <span className="scene-spacer" />
        <button className="scene-primary" onClick={onKey} disabled={disabled || playing || takeRecording}>
          <SceneIcon name="key" />
          {occupied ? "Update pose" : "Set pose"}
          <kbd>K</kbd>
        </button>
        <button
          aria-label={selectedFrames.length > 0 ? "Delete selected poses" : "Delete current pose"}
          title={selectedFrames.length > 0 ? "Delete selected · Backspace" : "Delete current pose · Backspace"}
          onClick={onDelete}
          disabled={!canDelete}
        >
          <SceneIcon name="close" />
          {selectedFrames.length > 0 ? <kbd>⌫</kbd> : null}
        </button>
      </div>
      <div className="scene-take-bar" role="group" aria-label="Camera takes">
        <span className="scene-take-label">Takes</span>
        {takes.length === 0 && <span className="scene-take-empty">None yet · Record or press K</span>}
        {takes.map((take) => (
          <button
            key={take.id}
            type="button"
            className={take.id === activeTakeId ? "is-active-take" : ""}
            aria-pressed={take.id === activeTakeId}
            disabled={disabled || takeRecording}
            title={`${take.name} · ${take.keyCount} poses · ${take.source} · used by Generate when selected`}
            onClick={() => onSelectTake(take.id)}
          >
            {take.name}
            <small>{take.keyCount}</small>
          </button>
        ))}
        {activeTakeId && (
          <button
            type="button"
            className="scene-take-delete"
            aria-label="Delete selected take"
            disabled={disabled || takeRecording || takes.length === 0}
            onClick={() => onDeleteTake(activeTakeId)}
          >
            Delete take
          </button>
        )}
      </div>
      <div className="scene-track-scroll">
        <div className="scene-track-row scene-ruler">
          <span>SHOT TRACKS</span>
          <div>
            <input
              aria-label="Shot playhead"
              type="range"
              min={0}
              max={end}
              step={1}
              value={Math.min(frame, end)}
              disabled={takeRecording}
              onChange={(event) => {
                onSelectedFramesChange([]);
                onScrub(Number(event.target.value));
              }}
            />
            <div className="scene-ticks">
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index}>{(end * index / 4 / fps).toFixed(1)}s</span>
              ))}
            </div>
          </div>
        </div>
        {tracks.map((track) => (
          <div key={track.id} className={`scene-track-row ${activeId === track.id ? "is-selected" : ""}`}>
            <button
              className="scene-track-name"
              onClick={() => {
                onSelect(track.id);
                onSelectedFramesChange([]);
              }}
            >
              <SceneIcon name={track.id === "camera" ? "camera" : "layers"} />
              <span>{track.name}</span>
              <small>{track.frames.length}</small>
            </button>
            <div
              className="scene-track-lane"
              onPointerDown={(event) => beginLaneDrag(event, track)}
              onPointerMove={moveLaneDrag}
              onPointerUp={endLaneDrag}
              onPointerCancel={endLaneDrag}
            >
              <span className="scene-playhead" style={{ left: `${Math.min(frame / end, 1) * 100}%` }} />
              {marquee?.trackId === track.id && (
                <span
                  className="scene-marquee"
                  style={{
                    left: `${Math.max(0, marquee.left)}px`,
                    width: `${Math.max(1, marquee.right - marquee.left)}px`,
                  }}
                />
              )}
              {track.frames
                .filter((key) => key >= 0 && key < duration)
                .map((key) => (
                  <span
                    key={key}
                    className={`scene-pose-dot ${key === frame ? "is-current" : ""} ${selectedSet.has(key) && activeId === track.id ? "is-selected" : ""}`}
                    style={{ left: `${key / end * 100}%` }}
                    aria-hidden="true"
                    title={`${key}f · ${(key / fps).toFixed(2)}s`}
                  >
                    <SceneIcon name="key" />
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
