import { useMemo } from "react";
import { CacheStatusBadge, needsRerender } from "../../components/CacheStatusBadge";
import { ReferenceBadge } from "../../components/ReferenceBadge";
import { getAffectedClipIds } from "../../core/dependency/affectedClips";
import { queueLength } from "../../core/render/queue";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { performancePlanFromNode, performancePlanNodeIdForClip } from "../../domain/performance";
import { clipStartFrame } from "../../domain/timeline/timing";
import { useEditorStore } from "../../state/editorStore";

const FPS = 24;
const PIXELS_PER_SECOND = 48;

const collectClipReferenceTypes = (
  clipGraphNodeIds: string[],
  nodes: Record<string, { referenceType: import("../../core/references/types").ReferenceType }>,
) => {
  const types = new Set<import("../../core/references/types").ReferenceType>();
  clipGraphNodeIds.forEach((nodeId) => {
    const node = nodes[nodeId];
    if (node) {
      types.add(node.referenceType);
    }
  });
  return Array.from(types);
};

const formatRulerLabel = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

interface TimelinePanelProps {
  compact?: boolean;
}

export const TimelinePanel = ({ compact = false }: TimelinePanelProps) => {
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
  const selectedGraph = project.clipGraphs[selectedClip.clipGraphId];
  const selectedPerformanceNodeId =
    selectedClip.performancePlanNodeId ?? performancePlanNodeIdForClip(selectedClip.id);
  const performancePlan = performancePlanFromNode(
    project.nodes[selectedPerformanceNodeId]?.parameters,
  );
  const selectedCameraNodeId =
    selectedClip.cameraPathNodeId ?? selectedClip.cameraTrajectoryNodeId ?? `node-${selectedClip.id}-trajectory`;
  const cameraPath = cameraPathParamsFromNode(project.nodes[selectedCameraNodeId]?.parameters ?? {});
  const selectedRootNode = project.nodes[`node-${selectedClip.id}-clip`];
  const affectedClipIds = selectedRootNode
    ? getAffectedClipIds(project.dependencyMap, selectedRootNode.id)
    : [];

  const durationSeconds = Math.max(
    12,
    Math.ceil(activeSequence.visibleRange[1] / FPS),
  );
  const rulerMarks = Array.from({ length: durationSeconds + 1 }, (_, index) => index);
  const playheadLeft = (activeSequence.playhead / FPS) * PIXELS_PER_SECOND;

  return (
    <section className={`panel timeline-panel ${compact ? "timeline-panel-compact" : ""}`}>
      {!compact && (
        <div className="panel-header">
          <div>
            <p className="eyebrow">Composer / Timeline</p>
            <h2>Timeline</h2>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => dispatch({ type: "add-empty-clip" })}>
              Add Empty Clip
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "delete-clip", clipId: selectedClip.id })}
              disabled={activeSequence.clipIds.length <= 1}
            >
              Delete Clip
            </button>
            <button type="button" onClick={() => dispatch({ type: "toggle-playback" })}>
              {ui.playback === "playing" ? "Stop" : "Play"}
            </button>
            {ui.pendingRerender && (
              <button type="button" onClick={() => dispatch({ type: "approve-partial-rerender" })}>
                Approve Rerender ({ui.pendingRerender.affectedClipIds.length})
              </button>
            )}
          </div>
        </div>
      )}

      {compact && (
        <div className="timeline-compact-toolbar">
          <div className="button-row wrap">
            <button type="button" onClick={() => dispatch({ type: "add-empty-clip" })}>
              Add Clip
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "delete-clip", clipId: selectedClip.id })}
              disabled={activeSequence.clipIds.length <= 1}
            >
              Delete
            </button>
          </div>
          {queueLength(ui.renderQueue) > 0 && (
            <p className="muted timeline-queue-hint">Render queue: {queueLength(ui.renderQueue)} job(s)</p>
          )}
        </div>
      )}

      <div className="timeline-editor">
        <div className="timeline-ruler" style={{ width: durationSeconds * PIXELS_PER_SECOND }}>
          {rulerMarks.map((second) => (
            <span
              key={second}
              className="timeline-ruler-mark"
              style={{ left: second * PIXELS_PER_SECOND }}
            >
              {formatRulerLabel(second)}
            </span>
          ))}
          <div className="timeline-playhead" style={{ left: playheadLeft }} />
        </div>

        <div className="timeline-tracks">
          <div className="timeline-track-row">
            <span className="track-label">V1</span>
            <div className="timeline-track-lane" style={{ width: durationSeconds * PIXELS_PER_SECOND }}>
              {clips.map((clip) => {
                const graph = project.clipGraphs[clip.clipGraphId];
                const refTypes = collectClipReferenceTypes(graph?.nodeIds ?? [], project.nodes);
                const width = (clip.duration / FPS) * PIXELS_PER_SECOND;
                const left = (clip.start / FPS) * PIXELS_PER_SECOND;
                const proxyStatus = clip.proxyCacheId
                  ? project.caches[clip.proxyCacheId]?.status
                  : undefined;

                return (
                  <button
                    key={clip.id}
                    type="button"
                    className={`timeline-clip-block ${clip.id === ui.selectedClipId ? "is-selected" : ""}`}
                    style={{ width, left }}
                    onClick={() => dispatch({ type: "select-clip", clipId: clip.id })}
                  >
                    <strong>{clip.name}</strong>
                    <span className="badge-row">
                      {refTypes.map((referenceType) => (
                        <ReferenceBadge key={referenceType} referenceType={referenceType} />
                      ))}
                    </span>
                    {proxyStatus && <CacheStatusBadge status={proxyStatus} />}
                    {needsRerender(clip.cacheStatus) && (
                      <span className="badge badge-rerender">Rerender</span>
                    )}
                    {clip.proxyCacheId && project.caches[clip.proxyCacheId]?.status === "valid" && (
                      <span className="badge">Proxy</span>
                    )}
                    {clip.activeVariantId && clip.activeVariantId !== "main" && (
                      <span className="badge">{clip.activeVariantId}</span>
                    )}
                    {clip.proxyCacheId && project.caches[clip.proxyCacheId]?.status === "failed" && (
                      <button
                        type="button"
                        className="inline-retry"
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({ type: "retry-failed-render", clipId: clip.id, kind: "proxy" });
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="timeline-track-row timeline-track-camera">
            <span className="track-label">CAM</span>
            <div className="timeline-track-lane" style={{ width: durationSeconds * PIXELS_PER_SECOND }}>
              {cameraPath.keyframes.map((keyframe) => (
                <button
                  key={`camera-${keyframe.frame}`}
                  type="button"
                  className="timeline-keyframe-marker camera-keyframe-marker"
                  style={{ left: ((clipStartFrame(selectedClip) + keyframe.frame) / FPS) * PIXELS_PER_SECOND }}
                  title={`Camera keyframe ${keyframe.frame}f · ${keyframe.focalLengthMm}mm`}
                  onClick={() => {
                    dispatch({ type: "scrub-playhead", playhead: clipStartFrame(selectedClip) + keyframe.frame });
                    dispatch({ type: "select-node", nodeId: selectedCameraNodeId });
                  }}
                >
                  ◆
                </button>
              ))}
            </div>
          </div>

          <div className="timeline-track-row timeline-track-audio">
            <span className="track-label">AUD</span>
            <div className="timeline-track-lane" style={{ width: durationSeconds * PIXELS_PER_SECOND }}>
              {performancePlan.audioGuide && (
                <button
                  type="button"
                  className="timeline-direction-block timeline-audio-block"
                  style={{
                    left:
                      ((clipStartFrame(selectedClip) + performancePlan.audioGuide.offsetFrame) / FPS) *
                      PIXELS_PER_SECOND,
                    width:
                      ((performancePlan.audioGuide.durationFrames ?? selectedClip.duration) / FPS) *
                      PIXELS_PER_SECOND,
                  }}
                  title={`${performancePlan.audioGuide.label} · offset ${performancePlan.audioGuide.offsetFrame}f`}
                  onClick={() => dispatch({ type: "set-panel-tab", tab: "direction" })}
                >
                  {performancePlan.audioGuide.label}
                </button>
              )}
            </div>
          </div>

          <div className="timeline-track-row timeline-track-performance">
            <span className="track-label">PERF</span>
            <div className="timeline-track-lane" style={{ width: durationSeconds * PIXELS_PER_SECOND }}>
              {performancePlan.cues.map((cue) => (
                <button
                  key={cue.id}
                  type="button"
                  className={`timeline-direction-block timeline-performance-block cue-${cue.kind}`}
                  style={{
                    left: ((clipStartFrame(selectedClip) + cue.startFrame) / FPS) * PIXELS_PER_SECOND,
                    width: (Math.max(1, cue.endFrame - cue.startFrame) / FPS) * PIXELS_PER_SECOND,
                  }}
                  title={`${cue.label} · ${cue.startFrame}–${cue.endFrame}f · ${cue.direction || "No direction"}`}
                  onClick={() => {
                    dispatch({ type: "scrub-playhead", playhead: clipStartFrame(selectedClip) + cue.startFrame });
                    dispatch({ type: "select-node", nodeId: selectedPerformanceNodeId });
                    dispatch({ type: "set-panel-tab", tab: "direction" });
                  }}
                >
                  {cue.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!compact && (
        <div className="timeline-footer">
          <label className="stack compact">
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
          {affectedClipIds.length > 0 && (
            <div className="affected-clips-readonly stack compact">
              <h3>Affected Clips (read-only)</h3>
              <ul>
                {affectedClipIds.map((clipId) => (
                  <li key={clipId}>{project.clips[clipId]?.name ?? clipId}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="button-row wrap">
            <button type="button" onClick={() => dispatch({ type: "create-variant", clipId: selectedClip.id })}>
              Create Variant
            </button>
            {(selectedClip.variants ?? []).map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() =>
                  dispatch({ type: "set-active-variant", clipId: selectedClip.id, variantId: variant.id })
                }
              >
                {variant.id === selectedClip.activeVariantId ? `● ${variant.name}` : variant.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
