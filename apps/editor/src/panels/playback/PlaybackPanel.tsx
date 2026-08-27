import { useMemo } from "react";
import { useEditorStore } from "../../state/editorStore";

const FPS = 24;

const formatTimecode = (frame: number): string => {
  const totalSeconds = Math.floor(frame / FPS);
  const frames = frame % FPS;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return [
    String(hours).padStart(2, "0"),
    String(mins).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
    String(frames).padStart(2, "0"),
  ].join(":");
};

export const PlaybackPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const sequence = project.sequences[project.activeSequenceId];
  const proxyCache = clip.proxyCacheId ? project.caches[clip.proxyCacheId] : undefined;
  const finalCache = clip.finalCacheId ? project.caches[clip.finalCacheId] : undefined;
  const videoPath = finalCache?.artifactPath ?? (proxyCache?.status === "valid" ? proxyCache.artifactPath : undefined);
  const videoRenderJob = ui.videoRenderJob;
  const timecode = formatTimecode(sequence.playhead);

  const statusLabel = useMemo(() => {
    if (videoRenderJob?.status === "running") {
      return `Rendering ${Math.round(videoRenderJob.progress * 100)}%`;
    }
    if (videoRenderJob?.status === "queued") {
      return "Render queued";
    }
    if (finalCache?.status === "failed") {
      return "Render failed";
    }
    if (videoPath) {
      return "Ready";
    }
    return "No render";
  }, [finalCache?.status, videoPath, videoRenderJob]);

  return (
    <section className="playback-panel">
      <div className="playback-viewport">
        {videoPath ? (
          <video
            key={videoPath}
            className="playback-video"
            src={videoPath}
            controls
            playsInline
          />
        ) : (
          <div className="playback-placeholder">
            <span className="rec-badge">● REC {timecode}</span>
            <p>Render a clip to preview generative video output.</p>
            <p className="muted">
              {proxyCache?.status === "valid"
                ? `Proxy ready (${proxyCache.previewText ?? "stub"}). Final render still optional.`
                : "Uses SpatialMemoryCache + keyframes for spatial consistency."}
            </p>
          </div>
        )}
        <div className="playback-overlay">
          <span>{clip.name}</span>
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className="playback-transport">
        <div className="transport-buttons">
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "scrub-playhead",
                playhead: Math.max(sequence.visibleRange[0], sequence.playhead - FPS),
              })
            }
          >
            ⏮
          </button>
          <button type="button" onClick={() => dispatch({ type: "toggle-playback" })}>
            {ui.playback === "playing" ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "scrub-playhead",
                playhead: Math.min(sequence.visibleRange[1], sequence.playhead + FPS),
              })
            }
          >
            ⏭
          </button>
        </div>
        <span className="transport-timecode">{timecode}</span>
        <button
          type="button"
          className="btn-primary"
          onClick={() => dispatch({ type: "submit-video-render", clipId: clip.id })}
          disabled={videoRenderJob?.status === "running" || videoRenderJob?.status === "queued"}
        >
          Render to Video
        </button>
        {videoRenderJob && (videoRenderJob.status === "running" || videoRenderJob.status === "queued") && (
          <span className="muted">{videoRenderJob.message}</span>
        )}
      </div>
    </section>
  );
};
