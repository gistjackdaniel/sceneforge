import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useEditorStore, type ViewportTool, type ViewportWorkspace } from "../../state/editorStore";
import {
  StageViewport,
  type StageCameraPose,
  type StageObjectTransform,
  type ViewportSelection,
} from "./StageViewport";
import { resolveShotState } from "../../domain/worlds/layers";
import {
  cameraPathParamsFromNode,
  interpolateCameraPose,
  keyframeAtExactFrame,
  nextKeyframeFrame,
  previousKeyframeFrame,
  sampleCameraPath,
  type CameraInterpolation,
} from "../../domain/graph/cameraPath";
import { CAMERA_RIG_PRESETS, type CameraRigPreset } from "../../domain/graph/cameraRig";
import {
  lensNodeIdForClip,
  lensParamsFromNode,
  verticalFovFromLens,
  type SensorPreset,
} from "../../domain/graph/lens";
import { clipDurationFrames, clipStartFrame } from "../../domain/timeline/timing";
import { validateLookAtElement } from "../../application/services/cameraCraft";
import {
  OVERLAY_LABELS,
  firstViewportImageUri,
  resolveViewportRepresentation,
  worldOverlayAvailability,
  type OverlayKind,
  type ViewportLoadState,
} from "../../domain/worlds/viewportRepresentation";
import {
  cameraPathNodeIdForClip,
  eulerToQuaternionApprox,
  quaternionToEulerApprox,
  readPlacementTransform,
} from "../../application/services/viewportCommit";
import {
  DEFAULT_OUTPUT_ASPECT,
  OUTPUT_ASPECT_PRESETS,
  outputAspectCss,
  outputAspectRatio,
} from "../../domain/rendering";

interface StagePanelProps {
  compact?: boolean;
  alwaysActive?: boolean;
}

const OBJECT_TOOLS: Array<{ id: ViewportTool; label: string; key?: string }> = [
  { id: "navigate", label: "Orbit", key: "Q" },
  { id: "select", label: "Select", key: "Q" },
  { id: "translate", label: "Move", key: "W" },
  { id: "rotate", label: "Rotate", key: "E" },
  { id: "scale", label: "Scale", key: "R" },
];

const SENSOR_PRESETS: Array<{ id: SensorPreset; label: string }> = [
  { id: "full-frame", label: "Full Frame" },
  { id: "super35", label: "Super 35" },
  { id: "micro-four-thirds", label: "MFT" },
];

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

export const StagePanel = ({ compact = false, alwaysActive = false }: StagePanelProps) => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = ui.selectedClipId ? project.clips[ui.selectedClipId] : undefined;
  const previewWorld = ui.previewWorldId ? project.worlds[ui.previewWorldId] : undefined;
  const linkedWorld = clip?.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
  const world = previewWorld ?? linkedWorld;
  const isPreviewOnly = Boolean(previewWorld && previewWorld.id !== clip?.linkedWorldId);
  const activeSequence = project.sequences[project.activeSequenceId];
  const [captureSignal, setCaptureSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [loadState, setLoadState] = useState<ViewportLoadState>("idle");
  const [loadMessage, setLoadMessage] = useState<string>();
  const [selection, setSelection] = useState<ViewportSelection>();

  const previewPlan = useMemo(() => resolveViewportRepresentation(world), [world]);
  const overlayAvailability = useMemo(() => worldOverlayAvailability(world), [world]);
  const fallbackImageUri = useMemo(() => firstViewportImageUri(world, project.assets), [world, project.assets]);
  const overlays = useMemo(() => {
    const next = { ...ui.viewportOverlays };
    (Object.keys(OVERLAY_LABELS) as OverlayKind[]).forEach((key) => {
      next[key] = overlayAvailability[key].available && ui.viewportOverlays[key];
    });
    return next;
  }, [overlayAvailability, ui.viewportOverlays]);

  const resolved = useMemo(
    () =>
      resolveShotState({
        world,
        sequence: activeSequence,
        clip,
        cameraFrame: activeSequence?.playhead,
      }),
    [world, activeSequence, clip],
  );

  const durationFrames = clip ? clipDurationFrames(clip) : 0;
  const startFrame = clip ? clipStartFrame(clip) : 0;
  const localFrame = Math.max(0, (activeSequence?.playhead ?? 0) - startFrame);

  const cameraNodeId = clip ? cameraPathNodeIdForClip(clip) : undefined;
  const cameraNode = cameraNodeId ? project.nodes[cameraNodeId] : undefined;
  const cameraParams = cameraNode ? cameraPathParamsFromNode(cameraNode.parameters) : undefined;
  const lensNode = clip ? project.nodes[lensNodeIdForClip(clip.id)] : undefined;
  const lens = lensParamsFromNode(lensNode?.parameters ?? {});
  const collidingKeyframe = cameraParams ? keyframeAtExactFrame(cameraParams, localFrame) : undefined;
  const outsideCount = cameraParams
    ? cameraParams.keyframes.filter((item) => item.frame < 0 || item.frame >= Math.max(1, durationFrames)).length
    : 0;
  const lookAtCheck = validateLookAtElement(cameraParams?.lookAtTargetElementId, world?.elements ?? []);
  const cameraViz = ui.cameraViz ?? { frustum: true, path: true, lookAtLine: true, keyframeMarkers: true };
  const pathSamples = useMemo(
    () => (cameraParams ? sampleCameraPath(cameraParams, 32) : []),
    [cameraParams],
  );

  // Persist a viewport pick as a graph mutation via DomainCommand bus.
  // We deliberately route through the existing commit-object-transform action to reuse
  // placement node creation/update semantics and keep undo/redo support.
  useEffect(() => {
    if (!clip || !selection || isPreviewOnly) {
      return;
    }
    if (selection.kind === "camera") {
      // Camera picks are handled explicitly by camera keyframe operations; skip here.
      return;
    }
    // Guard: only reference existing packaged elements for the linked world.
    const existsInLinkedWorld = Boolean(
      world?.id === clip.linkedWorldId && (world?.elements ?? []).some((e) => e.id === selection.id),
    );
    if (!existsInLinkedWorld) {
      return;
    }
    dispatch({
      type: "commit-object-transform",
      clipId: clip.id,
      worldElementId: selection.id,
      kind: selection.kind,
      position: selection.position,
      rotation: selection.rotation,
    });
    // Only react to element identity changes; position/rotation are provided to seed initial params
    // and will be updated through transform commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, selection?.id]);

  const cameraPose = useMemo((): StageCameraPose | undefined => {
    if (!cameraParams) {
      return undefined;
    }
    const pose = interpolateCameraPose(cameraParams, localFrame);
    if (!pose) {
      return undefined;
    }
    return {
      position: pose.position,
      rotation: quaternionToEulerApprox(pose.rotation),
      focalLength: pose.focalLengthMm || lens.focalLengthMm,
    };
  }, [cameraParams, localFrame, lens.focalLengthMm]);

  const fovDegrees = verticalFovFromLens({
    ...lens,
    focalLengthMm: cameraPose?.focalLength ?? lens.focalLengthMm,
  });

  const objectTransforms = useMemo((): StageObjectTransform[] => {
    if (!clip || !world) {
      return [];
    }
    return world.elements.flatMap((element) => {
      const node = project.nodes[`node-${clip.id}-placement-${element.id}`];
      const transform = readPlacementTransform(node);
      if (!transform) {
        return [];
      }
      const kind =
        element.kind === "actor_mark" ? "actor" : element.kind === "light_socket" ? "light" : "prop";
      return [{ id: element.id, kind, ...transform }];
    });
  }, [clip, world, project.nodes]);

  const handleTransformCommit = useCallback(
    (payload: {
      worldElementId: string;
      kind: "actor" | "prop" | "light" | "camera";
      position: [number, number, number];
      rotation: [number, number, number];
      scale?: [number, number, number];
    }) => {
      if (!clip) {
        return;
      }
      dispatch({
        type: "commit-object-transform",
        clipId: clip.id,
        ...payload,
      });
    },
    [clip, dispatch],
  );

  const handleCapturePose = useCallback(
    (payload: { camera: StageCameraPose; objects: StageObjectTransform[] }) => {
      if (!clip) {
        return;
      }
      dispatch({
        type: "capture-keyframe",
        clipId: clip.id,
        pose: payload,
      });
    },
    [clip, dispatch],
  );

  const addOrUpdateCameraKeyframe = () => {
    if (!clip || !cameraPose) {
      return;
    }
    dispatch({
      type: "add-camera-keyframe",
      clipId: clip.id,
      frame: localFrame,
      position: cameraPose.position,
      rotation: eulerToQuaternionApprox(cameraPose.rotation),
      focalLengthMm: lens.focalLengthMm,
      focusDistanceM: lens.focusDistanceM,
      aperture: lens.aperture,
    });
  };

  const deleteCurrentKeyframe = () => {
    if (!clip) {
      return;
    }
    dispatch({ type: "delete-camera-keyframe", clipId: clip.id, frame: localFrame });
  };

  const jumpKeyframe = (direction: "prev" | "next") => {
    if (!clip || !cameraParams) {
      return;
    }
    const target =
      direction === "prev" ? previousKeyframeFrame(cameraParams, localFrame) : nextKeyframeFrame(cameraParams, localFrame);
    if (target === undefined) {
      return;
    }
    dispatch({ type: "scrub-playhead", playhead: startFrame + target });
  };

  const applyRig = (preset: CameraRigPreset) => {
    if (!clip) {
      return;
    }
    dispatch({ type: "set-camera-rig", clipId: clip.id, rig: preset });
  };

  const setWorkspace = (workspace: ViewportWorkspace) => {
    dispatch({ type: "set-viewport-workspace", workspace });
  };

  const stampKeyframe = () => {
    if (ui.viewportWorkspace === "record") {
      setCaptureSignal((value) => value + 1);
      return;
    }
    addOrUpdateCameraKeyframe();
  };

  const updateInterpolation = (interpolation: CameraInterpolation) => {
    if (!cameraNode) {
      return;
    }
    dispatch({
      type: "update-node-parameter",
      nodeId: cameraNode.id,
      key: "interpolation",
      value: interpolation,
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || (!alwaysActive && ui.panelTab !== "viewport")) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".assistant-panel, .timeline-panel-compact, .top-bar")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const recording = ui.viewportWorkspace === "record";
      if (recording) {
        if (key === "k") {
          event.preventDefault();
          stampKeyframe();
        }
        if (key === ",") jumpKeyframe("prev");
        if (key === ".") jumpKeyframe("next");
        return;
      }
      if (key === "q") {
        dispatch({ type: "set-viewport-tool", tool: ui.viewportTool === "select" ? "navigate" : "select" });
      }
      if (key === "w") dispatch({ type: "set-viewport-tool", tool: "translate" });
      if (key === "e") dispatch({ type: "set-viewport-tool", tool: "rotate" });
      if (key === "r") dispatch({ type: "set-viewport-tool", tool: "scale" });
      if (key === "f") setFocusSignal((value) => value + 1);
      if (key === ",") jumpKeyframe("prev");
      if (key === ".") jumpKeyframe("next");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const linkedMissing = Boolean(clip?.linkedWorldId && !linkedWorld && !previewWorld);
  const emptyLabel = linkedMissing
    ? "이 클립이 참조하는 월드가 삭제되었거나 없습니다."
    : !world
      ? "표시할 월드가 없습니다. World Gen에서 Preview 또는 Use in Current Clip을 사용하세요."
      : previewPlan.kind === "unsupported"
        ? previewPlan.reason ?? "이 표현은 Viewport에서 지원하지 않습니다."
        : loadState === "loading"
          ? "월드를 불러오는 중…"
          : loadState === "missing_artifact"
            ? loadMessage ?? "미리보기 artifact가 없습니다."
            : loadState === "malformed"
              ? loadMessage ?? "월드 매니페스트가 올바르지 않습니다."
              : loadState === "unsupported"
                ? loadMessage ?? previewPlan.reason ?? "이 표현은 Viewport에서 지원하지 않습니다."
                : undefined;
  const recording = ui.viewportWorkspace === "record";
  const outputAspect = ui.outputAspect ?? DEFAULT_OUTPUT_ASPECT;
  const aspectCss = outputAspectCss(outputAspect);

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

      <div className="viewport-layer-banner">
        {isPreviewOnly ? (
          <span>Preview only — clip graph is unchanged</span>
        ) : (
          <span>
            Editing: Clip Override · Resolved from:{" "}
            {resolved.layers.map((layer) => layer.scope).join(" → ") || "Master"}
          </span>
        )}
      </div>

      <div className="workspace-switch" role="tablist" aria-label="Viewport workspace">
        <button
          type="button"
          role="tab"
          aria-selected={!recording}
          className={!recording ? "is-active-tool" : ""}
          onClick={() => setWorkspace("build")}
        >
          Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={recording}
          className={recording ? "is-active-tool" : ""}
          onClick={() => setWorkspace("record")}
        >
          Record
        </button>
        <p className="muted camera-mode-hint">
          {recording
            ? "1인칭 촬영. 출력 비율로 보고, WASD로 이동 · 우클릭 드래그로 시선 · K로 키프레임."
            : "3D 에셋, 조명, 카메라를 배치합니다. Orbit으로 장면을 둘러보고 기즈모로 옮깁니다."}
        </p>
      </div>

      <div className="stage-toolbar viewport-tools">
        {recording ? (
          <div className="button-row wrap record-tools">
            <span className="label">Aspect</span>
            {OUTPUT_ASPECT_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={outputAspect === item.id ? "is-active-tool" : ""}
                onClick={() => dispatch({ type: "set-output-aspect", aspect: item.id })}
              >
                {item.label}
              </button>
            ))}
            <button type="button" disabled={!clip} onClick={() => jumpKeyframe("prev")}>
              Prev (,)
            </button>
            <button type="button" disabled={!clip} onClick={() => jumpKeyframe("next")}>
              Next (.)
            </button>
            <button type="button" disabled={!clip} onClick={stampKeyframe}>
              {collidingKeyframe ? "Update Keyframe (K)" : "Add Keyframe (K)"}
            </button>
            <button type="button" disabled={!clip || !collidingKeyframe} onClick={deleteCurrentKeyframe}>
              Delete
            </button>
            <button
              type="button"
              disabled={!clip || outsideCount === 0}
              onClick={() => clip && dispatch({ type: "trim-camera-keyframes", clipId: clip.id })}
            >
              Trim{outsideCount > 0 ? ` (${outsideCount})` : ""}
            </button>
            <button type="button" onClick={() => setResetSignal((value) => value + 1)}>
              Reset Shot
            </button>
            {collidingKeyframe && (
              <span className="keyframe-collision">This frame already has a keyframe — save will replace it.</span>
            )}
          </div>
        ) : (
          <div className="button-row wrap">
            {OBJECT_TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={ui.viewportTool === item.id ? "is-active-tool" : ""}
                onClick={() => dispatch({ type: "set-viewport-tool", tool: item.id })}
              >
                {item.label}
                {item.key ? ` (${item.key})` : ""}
              </button>
            ))}
            <button type="button" onClick={() => setFocusSignal((value) => value + 1)}>
              Focus Selected (F)
            </button>
            <button type="button" onClick={() => setResetSignal((value) => value + 1)}>
              Reset View
            </button>
          </div>
        )}
      </div>

      <div className={compact ? "stage-compact-layout" : "stage-layout"}>
        <div
          className={`viewport-frame ${recording ? "is-record" : "is-build"}`}
          style={
            recording
              ? ({
                  "--record-aspect": aspectCss.ratio,
                  "--record-aspect-num": String(aspectCss.numeric),
                } as CSSProperties)
              : undefined
          }
        >
          <div className={recording ? "record-stage" : "build-stage"}>
            <StageViewport
            world={world}
            worldName={world?.name}
            previewPlan={previewPlan}
            fallbackImageUri={fallbackImageUri}
            overlays={overlays}
            tool={ui.viewportTool}
            workspace={ui.viewportWorkspace}
            outputAspect={outputAspectRatio(outputAspect)}
            outputAspectLabel={outputAspect}
            cameraViz={cameraViz}
            cameraPose={cameraPose}
            objectTransforms={objectTransforms}
            keyframes={cameraParams?.keyframes}
            pathSamples={pathSamples}
            lookAtTargetId={cameraParams?.lookAtTargetElementId}
            fovDegrees={fovDegrees}
            playheadFrame={localFrame}
            onTransformCommit={handleTransformCommit}
            onSelectionChange={setSelection}
            onLoadStateChange={(next, message) => {
              setLoadState(next);
              setLoadMessage(message);
            }}
            onCapturePose={handleCapturePose}
            captureSignal={captureSignal}
            focusSignal={focusSignal}
            resetSignal={resetSignal}
          />
          {emptyLabel && (
            <div className="viewport-empty-state">
              <span>{emptyLabel}</span>
              {!world && (
                <button type="button" onClick={() => dispatch({ type: "set-panel-tab", tab: "world-generation" })}>
                  Open World Gen
                </button>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="viewport-side-meta">
        {selection && (
          <p className="muted">
            Selected {selection.id} · {selection.kind} · layer {selection.layer} · pos{" "}
            {selection.position.map((value) => value.toFixed(2)).join(", ")}
          </p>
        )}
        <p className="muted">
          clip {localFrame}f / {durationFrames}f · keyframes: {cameraParams?.keyframes.length ?? 0} · mode:{" "}
          {clip?.worldMode ?? "unassigned"}
        </p>
      </div>

      <div className="stage-toolbar">
        <div className="overlay-toggles">
          {(Object.keys(OVERLAY_LABELS) as OverlayKind[]).map((key) => {
            const available = overlayAvailability[key];
            return (
              <label key={key} title={!available.available ? available.reason : undefined}>
                <input
                  type="checkbox"
                  checked={available.available && ui.viewportOverlays[key]}
                  disabled={!available.available}
                  onChange={(event) =>
                    dispatch({ type: "set-viewport-overlays", overlays: { [key]: event.target.checked } })
                  }
                />
                {OVERLAY_LABELS[key]}
              </label>
            );
          })}
        </div>
        <div className="overlay-toggles camera-viz-toggles">
          <span className="label">Camera viz</span>
          {(
            [
              ["frustum", "Frustum"],
              ["path", "Path"],
              ["lookAtLine", "Look-at"],
              ["keyframeMarkers", "Keyframes"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={cameraViz[key]}
                onChange={(event) => dispatch({ type: "set-camera-viz", viz: { [key]: event.target.checked } })}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="rig-preset-grid">
          <span className="label">CameraRigNode presets</span>
          {CAMERA_RIG_PRESETS.map((item) => (
            <button key={item.id} type="button" disabled={!clip} onClick={() => applyRig(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="camera-craft">
          <span className="label">LensNode</span>
          <label>
            Focal mm
            <input
              type="number"
              min={12}
              max={200}
              value={lens.focalLengthMm}
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "update-lens",
                  clipId: clip.id,
                  patch: { focalLengthMm: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Aperture
            <input
              type="number"
              min={0.7}
              step={0.1}
              value={lens.aperture ?? ""}
              placeholder="f"
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "update-lens",
                  clipId: clip.id,
                  patch: { aperture: event.target.value === "" ? undefined : Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Focus m
            <input
              type="number"
              min={0}
              step={0.1}
              value={lens.focusDistanceM ?? ""}
              placeholder="m"
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "update-lens",
                  clipId: clip.id,
                  patch: { focusDistanceM: event.target.value === "" ? undefined : Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Sensor
            <select
              value={lens.sensorPreset ?? "full-frame"}
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "update-lens",
                  clipId: clip.id,
                  patch: { sensorPreset: event.target.value as SensorPreset },
                })
              }
            >
              {SENSOR_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="camera-craft">
          <span className="label">Look-at</span>
          <label>
            World element ID
            <select
              value={cameraParams?.lookAtTargetElementId ?? ""}
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "set-look-at",
                  clipId: clip.id,
                  elementId: event.target.value || undefined,
                })
              }
            >
              <option value="">None</option>
              {(world?.elements ?? []).map((element) => (
                <option key={element.id} value={element.id}>
                  {element.id} ({element.kind})
                </option>
              ))}
            </select>
          </label>
          <label>
            Tracking
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={cameraParams?.trackingStrength ?? cameraParams?.stabilization ?? 0}
              disabled={!clip}
              onChange={(event) =>
                clip &&
                dispatch({
                  type: "set-look-at",
                  clipId: clip.id,
                  elementId: cameraParams?.lookAtTargetElementId,
                  trackingStrength: Number(event.target.value),
                })
              }
            />
          </label>
          {!lookAtCheck.ok && <span className="look-at-error">{lookAtCheck.reason}</span>}
        </div>

        {!recording && (
        <div className="camera-craft keyframe-row">
          <span className="label">Keyframes</span>
          <button type="button" disabled={!clip || !cameraPose} onClick={() => jumpKeyframe("prev")}>
            Prev (,)
          </button>
          <button type="button" disabled={!clip || !cameraPose} onClick={() => jumpKeyframe("next")}>
            Next (.)
          </button>
          <button type="button" disabled={!clip || !cameraPose} onClick={addOrUpdateCameraKeyframe}>
            {collidingKeyframe ? "Update Keyframe" : "Add Keyframe"}
          </button>
          <button type="button" disabled={!clip || !collidingKeyframe} onClick={deleteCurrentKeyframe}>
            Delete
          </button>
          <button type="button" disabled={!clip} onClick={() => setCaptureSignal((value) => value + 1)}>
            Capture Pose
          </button>
          <button
            type="button"
            disabled={!clip || outsideCount === 0}
            onClick={() => clip && dispatch({ type: "trim-camera-keyframes", clipId: clip.id })}
          >
            Trim outside duration{outsideCount > 0 ? ` (${outsideCount})` : ""}
          </button>
          {collidingKeyframe && (
            <span className="keyframe-collision">This frame already has a keyframe — save will replace it.</span>
          )}
        </div>
        )}

        <details className="camera-expert">
          <summary>Expert · interpolation & pose</summary>
          <div className="camera-craft">
            <label>
              Interpolation
              <select
                value={cameraParams?.interpolation ?? "linear"}
                onChange={(event) => updateInterpolation(event.target.value as CameraInterpolation)}
              >
                <option value="linear">linear</option>
                <option value="bezier">bezier</option>
                <option value="catmull_rom">catmull_rom</option>
              </select>
            </label>
            {cameraPose && (
              <span className="muted">
                pos {cameraPose.position.map((value) => value.toFixed(2)).join(", ")} · rot{" "}
                {cameraPose.rotation.map((value) => value.toFixed(2)).join(", ")}
              </span>
            )}
          </div>
        </details>

        {!compact && (
          <div className="button-row wrap shot-presets">
            <button type="button" onClick={() => clip && dispatch({ type: "run-stage-pass", clipId: clip.id })}>
              Stage Pass
            </button>
            <button type="button" onClick={() => dispatch({ type: "toggle-world-overlay" })}>
              {ui.showWorldOverlay ? "Hide Overlay" : "Show Overlay"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
