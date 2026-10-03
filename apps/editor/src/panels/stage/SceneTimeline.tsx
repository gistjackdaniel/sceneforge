import { SceneIcon } from "./SceneIcon";

export interface SceneTrackRow { id: string; name: string; frames: number[] }
export const SceneTimeline = ({ tracks, activeId, frame, duration, fps, playing, onSelect, onScrub, onPlay, onKey, onDelete, disabled }: {
  tracks: SceneTrackRow[]; activeId: string; frame: number; duration: number; fps: number; playing: boolean;
  onSelect: (id: string) => void; onScrub: (frame: number) => void; onPlay: () => void; onKey: () => void; onDelete: () => void; disabled: boolean;
}) => {
  const end = Math.max(1, duration - 1);
  const occupied = tracks.find((track) => track.id === activeId)?.frames.includes(frame);
  return (
    <section className="scene-timeline" aria-label="Shot motion tracks">
      <div className="scene-transport">
        <button aria-label={playing ? "Pause shot" : "Play shot"} onClick={onPlay} disabled={disabled}><SceneIcon name={playing ? "pause" : "play"} /></button>
        <output>{(frame / fps).toFixed(2)} <span>/ {(duration / fps).toFixed(2)} s</span></output>
        <span className="scene-spacer" />
        <button className="scene-primary" onClick={onKey} disabled={disabled || playing}><SceneIcon name="key" />{occupied ? "Update pose" : "Set pose"}<kbd>K</kbd></button>
        <button aria-label="Delete current pose" onClick={onDelete} disabled={!occupied || disabled || playing}><SceneIcon name="close" /></button>
      </div>
      <div className="scene-track-scroll">
        <div className="scene-track-row scene-ruler"><span>SHOT TRACKS</span><div>
          <input aria-label="Shot playhead" type="range" min={0} max={end} step={1} value={Math.min(frame, end)} onChange={(event) => onScrub(Number(event.target.value))} />
          <div className="scene-ticks">{Array.from({ length: 5 }, (_, index) => <span key={index}>{(end * index / 4 / fps).toFixed(1)}s</span>)}</div>
        </div></div>
        {tracks.map((track) => <div key={track.id} className={`scene-track-row ${activeId === track.id ? "is-selected" : ""}`}>
          <button className="scene-track-name" onClick={() => onSelect(track.id)}><SceneIcon name={track.id === "camera" ? "camera" : "layers"} /><span>{track.name}</span><small>{track.frames.length}</small></button>
          <div className="scene-track-lane" onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            onSelect(track.id);
            onScrub(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * end));
          }}>
            <span className="scene-playhead" style={{ left: `${Math.min(frame / end, 1) * 100}%` }} />
            {track.frames.filter((key) => key >= 0 && key < duration).map((key) => <button key={key} className={`scene-pose-dot ${key === frame ? "is-current" : ""}`} style={{ left: `${key / end * 100}%` }} aria-label={`${track.name} pose at frame ${key}`} title={`${key}f · ${(key / fps).toFixed(2)}s`} onClick={() => { onSelect(track.id); onScrub(key); }}><SceneIcon name="key" /></button>)}
          </div>
        </div>)}
      </div>
    </section>
  );
};
