import { useMemo } from "react";
import { useEditorStore } from "../../state/editorStore";
import { DIRECTION_CHANNEL_LABELS } from "../../domain/direction";
import { evaluateShotWorkflow } from "../../domain/workflow";
import { exportPerformancePlanToOtio, serializeOtio } from "../../domain/editorial";
import { performancePlanFromNode, performancePlanNodeIdForClip } from "../../domain/performance";
import { clipDurationFrames } from "../../domain/timeline/timing";
import { downloadTextFile, editorialFilename } from "../editorialDownload";

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
  const pendingDirectionInvalidations = finalCache?.directionInvalidations ?? [];
  const timecode = formatTimecode(sequence.playhead);
  const shotWorkflow = evaluateShotWorkflow({
    clip,
    graph: project.clipGraphs[clip.clipGraphId],
    nodes: project.nodes,
    worlds: project.worlds,
    caches: project.caches,
  });
  const renderBusy = videoRenderJob?.status === "running" || videoRenderJob?.status === "queued";
  const renderDisabled = renderBusy || !shotWorkflow.readyForRender;

  const exportOtio = () => {
    const performanceNodeId = clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
    const otioDocument = exportPerformancePlanToOtio({
      clipId: clip.id,
      clipName: clip.name,
      durationFrames: clipDurationFrames(clip),
      fps: sequence.fps ?? FPS,
      performancePlan: performancePlanFromNode(project.nodes[performanceNodeId]?.parameters),
    });
    downloadTextFile(
      serializeOtio(otioDocument),
      editorialFilename(clip.name, "otio"),
      "application/json",
    );
  };

  const statusLabel = useMemo(() => {
    if (videoRenderJob?.status === "running") {
      return `Rendering ${Math.round(videoRenderJob.progress * 100)}%`;
    }
    if (videoRenderJob?.status === "queued") {
      return "Render queued";
    }
    if (videoRenderJob?.status === "failed") {
      return "Render blocked";
    }
    if (finalCache?.status === "failed") {
      return "Render failed";
    }
    if (videoPath) {
      return "Ready";
    }
    if (!shotWorkflow.readyForRender) {
      return "Setup needed";
    }
    return "No render";
  }, [finalCache?.status, shotWorkflow.readyForRender, videoPath, videoRenderJob]);

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
              {!shotWorkflow.readyForRender
                ? `Next: ${shotWorkflow.nextActionLabel}. ${shotWorkflow.blockingIssues[0] ?? "Finish the shot setup."}`
                : proxyCache?.status === "valid"
                ? `Proxy ready (${proxyCache.previewText ?? "stub"}). Final render still optional.`
                : "Uses 3D shot signals + separate performance/audio direction."}
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
          id="playback-render-button"
          type="button"
          className="btn-primary"
          onClick={() => dispatch({ type: "submit-video-render", clipId: clip.id })}
          disabled={renderDisabled}
          title={!shotWorkflow.readyForRender ? shotWorkflow.blockingIssues.join(" ") : undefined}
        >
          {!shotWorkflow.readyForRender
            ? "Complete shot setup"
            : pendingDirectionInvalidations.length > 0
            ? `Re-render ${pendingDirectionInvalidations.length} channel(s)`
            : "Render to Video"}
        </button>
        {videoPath && (
          <button type="button" onClick={exportOtio} title="Export OpenTimelineIO with SceneForge direction metadata.">
            Export OTIO
          </button>
        )}
        {!shotWorkflow.readyForRender && (
          <span className="render-setup-message">
            {shotWorkflow.blockingIssues[0]}
          </span>
        )}
        {pendingDirectionInvalidations.length > 0 &&
          videoRenderJob?.status !== "running" &&
          videoRenderJob?.status !== "queued" && (
          <span className="direction-rerender-scope" title="Only these direction channels and authored frame windows are invalidated.">
            Partial · {pendingDirectionInvalidations.map((item) => DIRECTION_CHANNEL_LABELS[item.channel]).join(", ")}
          </span>
        )}
        {videoRenderJob && (videoRenderJob.status === "running" || videoRenderJob.status === "queued") && (
          <span className="muted">{videoRenderJob.message}</span>
        )}
        {videoRenderJob?.status === "failed" && (
          <span className="look-at-error" title={videoRenderJob.error}>{videoRenderJob.message}</span>
        )}
      </div>
    </section>
  );
};
