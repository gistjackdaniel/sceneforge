import { useMemo } from "react";
import { useEditorStore } from "../../state/editorStore";
import { DIRECTION_CHANNEL_LABELS } from "../../domain/direction";
import { evaluateShotWorkflow } from "../../domain/workflow";
import { exportPerformancePlanToOtio, serializeOtio } from "../../domain/editorial";
import { performancePlanFromNode, performancePlanNodeIdForClip } from "../../domain/performance";
import { shotFpsForClip } from "../../domain/timeline/shotClock";
import { frameToTimecode, isPositiveIntegerFps, shotLocalFrame } from "../../domain/timeline/timecode";
import { clipDurationFrames, clipStartFrame } from "../../domain/timeline/timing";
import { downloadTextFile, editorialFilename } from "../editorialDownload";

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
  const shot = project.shots?.[clip.id];
  const fps = shotFpsForClip(project, clip.id);
  const frame = shotLocalFrame({
    playhead: sequence.playhead,
    clipStartFrame: clipStartFrame(clip),
    durationFrames: shot?.time.durationFrames,
  });
  const timecode = isPositiveIntegerFps(fps) ? frameToTimecode(frame, fps) : "—";
  const clockLabel = `${frame}f ${timecode}`;
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
      fps,
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
            <span className="rec-badge">● REC {clockLabel}</span>
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
                playhead: Math.max(sequence.visibleRange[0], sequence.playhead - fps),
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
                playhead: Math.min(sequence.visibleRange[1], sequence.playhead + fps),
              })
            }
          >
            ⏭
          </button>
        </div>
        <span className="transport-timecode">{clockLabel}</span>
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
