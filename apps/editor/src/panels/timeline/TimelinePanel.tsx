import { useMemo } from "react";
import { useEditorStore } from "../../state/editorStore";

export const TimelinePanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const activeSequence = project.sequences[project.activeSequenceId];
  const clips = useMemo(
    () => activeSequence.clipIds.map((clipId) => project.clips[clipId]),
    [activeSequence.clipIds, project.clips],
  );
  const selectedClip = project.clips[ui.selectedClipId];

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Composer / Timeline</p>
          <h2>Timeline</h2>
        </div>
        <div className="button-row">
          <button onClick={() => dispatch({ type: "add-empty-clip" })}>Add Empty Clip</button>
          <button onClick={() => dispatch({ type: "toggle-playback" })}>
            {ui.playback === "playing" ? "Stop" : "Play"}
          </button>
          <button onClick={() => dispatch({ type: "render-proxy", clipId: selectedClip.id })}>
            Render Proxy
          </button>
          <button onClick={() => dispatch({ type: "render-final", clipId: selectedClip.id })}>
            Render Final
          </button>
        </div>
      </div>

      <label className="stack">
        <span>Playhead: {activeSequence.playhead}f</span>
        <input
          type="range"
          min={activeSequence.visibleRange[0]}
          max={activeSequence.visibleRange[1]}
          value={activeSequence.playhead}
          onChange={(event) =>
            dispatch({ type: "scrub-playhead", playhead: Number(event.target.value) })
          }
        />
      </label>

      <div className="timeline-track">
        {clips.map((clip) => (
          <button
            key={clip.id}
            className={`clip-card ${clip.id === ui.selectedClipId ? "is-selected" : ""}`}
            onClick={() => dispatch({ type: "select-clip", clipId: clip.id })}
          >
            <strong>{clip.name}</strong>
            <span>
              {clip.start}f - {clip.end}f
            </span>
            <span>mode: {clip.worldMode ?? "unassigned"}</span>
            <span>variant: {clip.variant ?? "main"}</span>
            <span>proxy: {clip.proxyCacheId ? project.caches[clip.proxyCacheId]?.status : "none"}</span>
            <span>final: {clip.finalCacheId ? project.caches[clip.finalCacheId]?.status : "none"}</span>
          </button>
        ))}
      </div>

      <div className="timeline-footer">
        <label className="stack compact">
          <span>Trim Selected Clip ({selectedClip.duration}f)</span>
          <input
            type="range"
            min={24}
            max={360}
            value={selectedClip.duration}
            onChange={(event) =>
              dispatch({
                type: "trim-clip",
                clipId: selectedClip.id,
                duration: Number(event.target.value),
              })
            }
          />
        </label>
        <div className="status-grid">
          <div>
            <span className="label">Linked World</span>
            <strong>{selectedClip.linkedWorldId ?? "없음"}</strong>
          </div>
          <div>
            <span className="label">ClipGraph</span>
            <strong>{selectedClip.clipGraphId}</strong>
          </div>
          <div>
            <span className="label">Audio Sync</span>
            <strong>{selectedClip.audioTrackId ?? "stub"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
};
