import { useCallback, useMemo, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import {
  StageViewport,
  type StageCameraPose,
  type StageObjectTransform,
} from "./StageViewport";
import { resolveShotState } from "../../domain/worlds/layers";
import { cameraPathParamsFromNode, cameraPoseAtFrame } from "../../domain/graph/cameraPath";

interface StagePanelProps {
  compact?: boolean;
}

export const StagePanel = ({ compact = false }: StagePanelProps) => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const world = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
  const activeSequence = project.sequences[project.activeSequenceId];
  const [captureSignal, setCaptureSignal] = useState(0);
  const overlayNode = project.nodes[`node-${clip.id}-overlay`];
  const showOverlay = ui.showWorldOverlay && overlayNode?.parameters.visible !== false;

  const resolved = useMemo(
    () =>
      resolveShotState({
        world,
        sequence: activeSequence,
        clip,
        cameraFrame: activeSequence.playhead,
      }),
    [world, activeSequence, clip],
  );

  const cameraNode = clip.cameraPathNodeId ? project.nodes[clip.cameraPathNodeId] : undefined;
  const cameraPose = useMemo((): StageCameraPose | undefined => {
    if (!cameraNode) {
      return undefined;
    }
    const pose = cameraPoseAtFrame(cameraPathParamsFromNode(cameraNode.parameters), activeSequence.playhead);
    if (!pose) {
      return undefined;
    }
    return {
      position: pose.position,
      rotation: [pose.rotation[0], pose.rotation[1], pose.rotation[2]],
      focalLength: pose.focalLengthMm,
    };
  }, [cameraNode, activeSequence.playhead]);

  const handleTransformChange = useCallback(
    (objectId: string, transform: StageObjectTransform) => {
      if (transform.kind === "actor") {
        dispatch({
          type: "set-actor-placement",
          clipId: clip.id,
          mark: objectId,
          position: transform.position,
          rotation: transform.rotation,
        });
        return;
      }
      if (transform.kind === "prop") {
        dispatch({
          type: "set-prop-placement",
          clipId: clip.id,
          prop: objectId,
          position: transform.position,
          rotation: transform.rotation,
        });
        return;
      }
      dispatch({
        type: "set-light-transform",
        clipId: clip.id,
        lightId: objectId,
        position: transform.position,
        rotation: transform.rotation,
      });
    },
    [clip.id, dispatch],
  );

  const handleCapturePose = useCallback(
    (payload: { camera: StageCameraPose; objects: StageObjectTransform[] }) => {
      dispatch({
        type: "capture-keyframe",
        clipId: clip.id,
        pose: payload,
      });
    },
    [clip.id, dispatch],
  );

  return (
    <section className={`panel stage-panel ${compact ? "stage-panel-compact" : ""}`}>
      {!compact && (
        <div className="panel-header">
          <div>
            <p className="eyebrow">World Module / Stage Viewer</p>
            <h2>Stage</h2>
          </div>
        </div>
      )}

      <div className={compact ? "stage-compact-layout" : "stage-layout"}>
        <StageViewport
          worldName={world?.name}
          previewPath={world?.previewPath ?? world?.surfaceMeshPath}
          showOverlay={showOverlay}
          cameraPose={cameraPose}
          onTransformChange={handleTransformChange}
          onCapturePose={handleCapturePose}
          captureSignal={captureSignal}
        />

        {!compact && (
          <div className="stage-controls">
            <p className="muted">
              playhead: {activeSequence.playhead}f · mode: {clip.worldMode ?? "unassigned"}
              {resolved.layers.length > 1 ? ` · layers: ${resolved.layers.map((layer) => layer.scope).join(" → ")}` : ""}
            </p>
          </div>
        )}
      </div>

      <div className="stage-toolbar">
        <div className="button-row wrap">
          <button type="button" onClick={() => setCaptureSignal((value) => value + 1)}>
            Capture Keyframe
          </button>
          <button type="button" onClick={() => dispatch({ type: "toggle-world-overlay" })}>
            {showOverlay ? "Hide Overlay" : "Show Overlay"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "run-stage-pass", clipId: clip.id })}>
            Stage Pass
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "set-actor-placement", clipId: clip.id, mark: "actor_mark_a" })}
          >
            Place Actor
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "set-prop-placement", clipId: clip.id, prop: "hero_chair" })}
          >
            Add Prop
          </button>
        </div>
        <div className="button-row wrap shot-presets">
          <button type="button" onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "WS" })}>
            WS
          </button>
          <button type="button" onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "MS" })}>
            MS
          </button>
          <button type="button" onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "CU" })}>
            CU
          </button>
          <button type="button" onClick={() => dispatch({ type: "apply-shot-preset", clipId: clip.id, preset: "OTS" })}>
            OTS
          </button>
          <button type="button" onClick={() => dispatch({ type: "set-lighting-rig", clipId: clip.id, rig: "3-point" })}>
            Light
          </button>
          <button type="button" onClick={() => dispatch({ type: "set-camera-rig", clipId: clip.id, rig: "dolly" })}>
            Camera
          </button>
        </div>
      </div>
    </section>
  );
};
