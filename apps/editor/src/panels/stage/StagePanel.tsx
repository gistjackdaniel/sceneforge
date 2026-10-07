import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, type ViewportTool } from "../../state/editorStore";
import { StageViewport, type StageCameraPose, type ViewportSelection } from "./StageViewport";
import { SceneIcon, type SceneIconName } from "./SceneIcon";
import { SceneTimeline } from "./SceneTimeline";
import { SceneAssets } from "./SceneAssets";
import { cameraPathParamsFromNode, interpolateCameraPose } from "../../domain/graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode, verticalFovFromLens } from "../../domain/graph/lens";
import { sampleCameraPath } from "../../domain/graph/cameraPath";
import { clipDurationFrames, clipStartFrame } from "../../domain/timeline/timing";
import { firstViewportImageUri, resolveViewportRepresentation, type ViewportLoadState } from "../../domain/worlds/viewportRepresentation";
import { cameraPathNodeIdForClip, eulerToQuaternionApprox, quaternionToEulerApprox, placementNodeIdForElement } from "../../application/services/viewportCommit";
import { resolveSceneObjects, readObjectTrack, sampleObjectTrack, objectTrackNodeId, type ObjectPose, type SceneObject } from "../../domain/worlds/sceneObjects";
import { buildSceneConditioning } from "../../domain/rendering/sceneConditioning";
import { OUTPUT_ASPECT_PRESETS, outputAspectRatio, type OutputAspectPreset } from "../../domain/rendering";
import { CAMERA_RIG_PRESETS, type CameraRigPreset } from "../../domain/graph/cameraRig";
import "./sceneWorkspace.css";

type Drawer = "assets" | "layers" | "light" | "camera" | "settings" | null;
const tools: Array<{ id: ViewportTool; icon: SceneIconName; label: string }> = [
  { id: "navigate", icon: "orbit", label: "Orbit · Q" },
  { id: "translate", icon: "move", label: "Move · W" },
  { id: "rotate", icon: "rotate", label: "Rotate · E" },
  { id: "scale", icon: "scale", label: "Scale · R" },
];
const typing = (target: EventTarget | null) => target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable);

export const StagePanel = ({ alwaysActive = false }: { compact?: boolean; alwaysActive?: boolean }) => {
  const { state: { project, ui }, dispatch } = useEditorStore();
  const clip = ui.selectedClipId ? project.clips[ui.selectedClipId] : undefined;
  const sequence = project.sequences[project.activeSequenceId];
  const world = (ui.previewWorldId ? project.worlds[ui.previewWorldId] : undefined) ?? (clip?.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined);
  const previewOnly = Boolean(world && world.id !== clip?.linkedWorldId);
  const recording = ui.viewportWorkspace === "record";
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [selectedId, setSelectedId] = useState<string>("camera");
  const [freeView, setFreeView] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [draft, setDraft] = useState<{ id: string; pose: ObjectPose }>();
  const [load, setLoad] = useState<{ state: ViewportLoadState; message?: string }>({ state: "idle" });
  const [notice, setNotice] = useState("");
  const duration = clip ? clipDurationFrames(clip) : 1;
  const start = clip ? clipStartFrame(clip) : 0;
  const frame = Math.max(0, Math.min(duration - 1, (sequence?.playhead ?? start) - start));
  const fps = sequence?.fps ?? 24;
  const graph = clip ? project.clipGraphs[clip.clipGraphId] : undefined;
  const nodes = useMemo(() => graph?.nodeIds.flatMap((id) => project.nodes[id] ? [project.nodes[id]] : []) ?? [], [graph, project.nodes]);
  const objects = useMemo(() => resolveSceneObjects(world, previewOnly ? [] : nodes), [world, nodes, previewOnly]);
  const cameraNode = clip ? project.nodes[cameraPathNodeIdForClip(clip)] : undefined;
  const cameraParams = useMemo(() => cameraPathParamsFromNode(cameraNode?.parameters ?? {}), [cameraNode]);
  const lens = lensParamsFromNode(clip ? project.nodes[lensNodeIdForClip(clip.id)]?.parameters ?? {} : {});
  const cameraPose = useMemo((): StageCameraPose | undefined => {
    const pose = interpolateCameraPose(cameraParams, frame);
    return pose ? { position: pose.position, rotation: quaternionToEulerApprox(pose.rotation), focalLength: pose.focalLengthMm || lens.focalLengthMm } : undefined;
  }, [cameraParams, frame, lens.focalLengthMm]);
  const sceneObjects = useMemo(() => objects.map((object) => ({
    ...object,
    ...(recording && clip ? sampleObjectTrack(readObjectTrack(project.nodes[objectTrackNodeId(clip.id, object.id)]?.parameters), frame) : undefined),
    ...(draft?.id === object.id ? draft.pose : undefined),
  })), [objects, recording, clip, project.nodes, frame, draft]);
  const selected = sceneObjects.find((object) => object.id === selectedId);
  const canEdit = Boolean(clip && !previewOnly);
  const cameraView = recording && !freeView && selectedId === "camera";
  const previewPlan = useMemo(() => resolveViewportRepresentation(world), [world]);
  const fallbackImageUri = useMemo(() => firstViewportImageUri(world, project.assets), [world, project.assets]);
  const pathSamples = useMemo(() => sampleCameraPath(cameraParams, 64), [cameraParams]);
  const lightNode = clip ? project.nodes[`node-${clip.id}-light`] : undefined;
  const lighting = useMemo(() => ({
    intensity: typeof lightNode?.parameters.intensity === "number" ? lightNode.parameters.intensity : 1.2,
    color: typeof lightNode?.parameters.color === "string" ? lightNode.parameters.color : "#ffffff",
  }), [lightNode]);
  const tracks = [
    { id: "camera", name: "Camera", frames: cameraParams.keyframes.map((key) => key.frame) },
    ...objects.map((object) => ({ id: object.id, name: object.name,
      frames: clip ? readObjectTrack(project.nodes[objectTrackNodeId(clip.id, object.id)]?.parameters)?.keyframes.map((key) => key.frame) ?? [] : [] })),
  ];
  const select = (id: string) => { setSelectedId(id); setDraft(undefined); if (id !== "camera") dispatch({ type: "set-viewport-tool", tool: "translate" }); };
  const scrub = (value: number) => { setDraft(undefined); dispatch({ type: "scrub-playhead", playhead: start + value }); };
  const patchObject = (object: SceneObject, patch: Record<string, unknown>) => {
    if (!clip || !canEdit || object.locked && !("locked" in patch)) return;
    const nodeId = placementNodeIdForElement(clip.id, object.id);
    if (!project.nodes[nodeId]) dispatch({ type: "add-scene-object", clipId: clip.id, object });
    Object.entries(patch).forEach(([key, value]) => dispatch({ type: "update-node-parameter", nodeId, key, value }));
  };
  const commitPose = (object: SceneObject, pose: ObjectPose) => {
    if (!clip || !canEdit || object.locked) return;
    if (recording) setDraft({ id: object.id, pose });
    else dispatch({ type: "commit-object-transform", clipId: clip.id, worldElementId: object.id, kind: object.kind, ...pose });
  };
  const captureCamera = useCallback(({ camera }: { camera: StageCameraPose }) => {
    if (!clip || previewOnly) return;
    dispatch({ type: "add-camera-keyframe", clipId: clip.id, frame,
      position: camera.position, rotation: eulerToQuaternionApprox(camera.rotation),
      focalLengthMm: lens.focalLengthMm, focusDistanceM: lens.focusDistanceM, aperture: lens.aperture });
    setNotice(`Camera pose saved · ${frame}f`);
  }, [clip, previewOnly, frame, dispatch, lens.focalLengthMm, lens.focusDistanceM, lens.aperture]);
  const stamp = () => {
    if (!canEdit || !clip || playing) return;
    if (selected) {
      if (selected.locked) return;
      dispatch({ type: "key-object", clipId: clip.id, elementId: selected.id, pose: selected, frame });
      setDraft(undefined); setNotice(`${selected.name} pose saved · ${frame}f`);
    } else setCaptureSignal((value) => value + 1);
  };
  const deletePose = () => {
    if (!clip || !canEdit) return;
    if (selected) dispatch({ type: "delete-object-key", clipId: clip.id, elementId: selected.id, frame });
    else dispatch({ type: "delete-camera-keyframe", clipId: clip.id, frame });
    setDraft(undefined);
  };
  const switchMode = (mode: "build" | "record") => {
    setPlaying(false); setDraft(undefined); setDrawer(null); setNotice("");
    dispatch({ type: "set-viewport-workspace", workspace: mode });
  };
  useEffect(() => { setSelectedId("camera"); setDraft(undefined); setPlaying(false); setNotice(""); }, [clip?.id, world?.id]);
  useEffect(() => { if (!recording) setPlaying(false); }, [recording]);
  const playbackStart = useRef(0);
  useEffect(() => {
    if (!playing) return;
    playbackStart.current = performance.now() - frame / fps * 1000;
    let request = 0;
    let lastFrame = -1;
    const tick = () => {
      const next = Math.min(duration - 1, Math.floor((performance.now() - playbackStart.current) / 1000 * fps));
      if (next !== lastFrame) { lastFrame = next; dispatch({ type: "scrub-playhead", playhead: start + next }); }
      if (next >= duration - 1) { setPlaying(false); return; }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, duration, start, fps, dispatch]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || (!alwaysActive && ui.panelTab !== "viewport") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest(".assistant-panel, .timeline-panel-compact, .top-bar")) return;
      const key = event.key.toLowerCase();
      if (key === "k" && recording) { event.preventDefault(); stamp(); }
      if (key === " " && recording && canEdit) { event.preventDefault(); setDraft(undefined); setPlaying((value) => !value); }
      if (key === "escape") { setDrawer(null); setDraft(undefined); setPlaying(false); }
      if (!cameraView) {
        const tool: ViewportTool | undefined = ({ q: "navigate", w: "translate", e: "rotate", r: "scale" } as Record<string, ViewportTool>)[key];
        if (tool) dispatch({ type: "set-viewport-tool", tool });
        if (key === "f") setFocusSignal((value) => value + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const exportScene = () => {
    if (!clip || !canEdit) return;
    const scene = buildSceneConditioning(clip, nodes, world, fps, ui.outputAspect);
    const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${clip.id}.scene.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Editable scene exported. A compatible scene encoder is required for video generation.");
  };
  const toggleDrawer = (value: Drawer) => setDrawer((current) => current === value ? null : value);
  const updateLens = (key: "focalLengthMm" | "focusDistanceM" | "aperture", value: number) => {
    if (clip && Number.isFinite(value)) dispatch({ type: "update-lens", clipId: clip.id, patch: { [key]: value } });
  };
  const emptyMessage = !world ? "Start with a world, or place your first object."
    : load.state === "loading" ? "Loading world…"
    : ["missing_artifact", "malformed", "unsupported"].includes(load.state) ? load.message ?? "World preview unavailable." : undefined;
  const showEmpty = emptyMessage && (objects.length === 0 || Boolean(world));
  return <section className="scene-workspace" aria-label="Scene workspace">
    <header className="scene-header">
      <div className="scene-title"><span className="scene-status-dot" /><strong>{clip?.name ?? "No shot selected"}</strong><span>{previewOnly ? "Preview only" : "Shot override"}</span></div>
      <div className="scene-mode-switch" role="group" aria-label="Workspace mode">
        <button aria-pressed={!recording} onClick={() => switchMode("build")}>Scene</button>
        <button aria-pressed={recording} onClick={() => switchMode("record")}>Motion</button>
      </div>
    </header>
    <div className="scene-stage-area">
      <div className={`scene-stage-canvas ${cameraView ? "is-camera-view" : ""}`} style={{ "--scene-aspect": outputAspectRatio(ui.outputAspect) } as React.CSSProperties}>
        <StageViewport world={world} worldName={world?.name} previewPlan={previewPlan} fallbackImageUri={fallbackImageUri}
          overlays={ui.viewportOverlays} tool={ui.viewportTool} workspace={cameraView ? "record" : "build"}
          outputAspect={outputAspectRatio(ui.outputAspect)} outputAspectLabel={ui.outputAspect}
          cameraViz={recording ? ui.cameraViz : { frustum: false, path: false, lookAtLine: false, keyframeMarkers: false }}
          cameraPose={cameraPose} sceneObjects={sceneObjects} selectedId={selectedId === "camera" ? undefined : selectedId}
          showCameraPreview={showPreview && !cameraView} readOnly={!canEdit || playing} lighting={lighting}
          keyframes={cameraParams.keyframes} pathSamples={pathSamples} fovDegrees={verticalFovFromLens({ ...lens, focalLengthMm: cameraPose?.focalLength ?? lens.focalLengthMm })}
          playheadFrame={frame} lookAtTargetId={cameraParams.lookAtTargetElementId}
          onSelectionChange={(selection: ViewportSelection | undefined) => { if (selection && selection.kind !== "camera") { setSelectedId(selection.id); setDrawer("layers"); } }}
          onTransformCommit={(payload) => { const object = sceneObjects.find((item) => item.id === payload.worldElementId); if (object) commitPose(object, { position: payload.position, rotation: payload.rotation, scale: payload.scale ?? object.scale }); }}
          onLoadStateChange={(state, message) => setLoad({ state, message })}
          onCapturePose={captureCamera} captureSignal={captureSignal} focusSignal={focusSignal} resetSignal={resetSignal} />
      </div>
      <nav className="scene-rail" aria-label="Scene tools">
        {([["assets", "plus", "Add assets"], ["layers", "layers", "Subjects"], ["camera", "camera", "Camera trajectory"]] as const).map(([id, icon, title]) =>
          <button key={id} className={drawer === id ? "is-active" : ""} aria-label={title} title={title} aria-expanded={drawer === id} onClick={() => toggleDrawer(id)}><SceneIcon name={icon} /></button>)}
      </nav>
      <div className="scene-view-controls">
        {recording && <button onClick={() => { setFreeView((value) => !value); setSelectedId("camera"); }} aria-pressed={freeView}><SceneIcon name={cameraView ? "camera" : "orbit"} />{cameraView ? "Camera view" : "Free view"}</button>}
        <button aria-label="Toggle camera preview" title="Camera preview" aria-pressed={showPreview} onClick={() => { setShowPreview((value) => !value); if (cameraView) setFreeView(true); }}><SceneIcon name="eye" /></button>
      </div>
      {showEmpty && <div className="scene-empty"><SceneIcon name="layers" /><h3>{!world ? "A scene, not a screenshot." : "World preview"}</h3><p>{emptyMessage}</p>
        {!world && <button onClick={() => dispatch({ type: "set-panel-tab", tab: "world-generation" })}>Choose a world</button>}</div>}
      {!cameraView && <div className="scene-transform-tools" role="group" aria-label="Transform tools">
        {tools.map((tool) => <button key={tool.id} aria-label={tool.label} title={tool.label} aria-pressed={ui.viewportTool === tool.id} onClick={() => dispatch({ type: "set-viewport-tool", tool: tool.id })}><SceneIcon name={tool.icon} /></button>)}
      </div>}
      {drawer && <aside className="scene-drawer" aria-label={`${drawer} panel`}>
        <div className="scene-drawer-heading"><strong>{{ assets: "Add 3D asset", layers: "Subjects", light: "Lighting", camera: "Camera trajectory", settings: "Scene output" }[drawer]}</strong><button aria-label="Close panel" onClick={() => setDrawer(null)}><SceneIcon name="close" /></button></div>
        {drawer === "assets" && <SceneAssets disabled={!canEdit} onAdd={(object, source) => { if (clip) { dispatch({ type: "add-scene-object", clipId: clip.id, object, source }); select(object.id); setDrawer("layers"); } }} />}
        {drawer === "layers" && <>
          <p className="scene-note">{world?.name ?? "Local scene"} · changes stay in this shot</p>
          <button className={`scene-layer ${selectedId === "camera" ? "is-selected" : ""}`} onClick={() => select("camera")}><SceneIcon name="camera" /><span>Shot camera</span><small>{cameraParams.keyframes.length} poses</small></button>
          {objects.map((object) => <div className={`scene-layer ${selectedId === object.id ? "is-selected" : ""}`} key={object.id}>
            <button onClick={() => select(object.id)}><SceneIcon name={object.kind === "light" ? "light" : "layers"} /><span>{object.name}</span></button>
            <button aria-label={`${object.visible ? "Hide" : "Show"} ${object.name}`} disabled={!canEdit || object.locked} aria-pressed={object.visible} onClick={() => patchObject(object, { visible: !object.visible })}><SceneIcon name="eye" /></button>
            <button aria-label={`${object.locked ? "Unlock" : "Lock"} ${object.name}`} disabled={!canEdit} aria-pressed={object.locked} onClick={() => patchObject(object, { locked: !object.locked })}><SceneIcon name="lock" /></button>
          </div>)}
          {selected && <><div className="scene-section-label">{selected.name} · {selected.representation === "marker" ? "placement marker" : "3D object"}</div>
            <button onClick={() => setFocusSignal((value) => value + 1)}>Focus selection <kbd>F</kbd></button>
            {selected.kind !== "light" && <label>Pose prompt<textarea aria-label={`${selected.name} pose prompt`} rows={3} placeholder="How this subject moves. Leave empty and record an explicit pose in Motion with K." value={selected.posePrompt ?? ""} disabled={!canEdit || selected.locked} onChange={(event) => patchObject(selected, { posePrompt: event.target.value })} /></label>}
            {(["position", "rotation", "scale"] as const).map((property) => <fieldset key={property} disabled={!canEdit || selected.locked || playing}><legend>{property}</legend><div className="scene-vector">
              {selected[property].map((value, axis) => <label key={axis}>{["X", "Y", "Z"][axis]}<input aria-label={`${property} ${["X", "Y", "Z"][axis]}`} type="number" step={property === "rotation" ? 5 : 0.1} value={Number((property === "rotation" ? value * 180 / Math.PI : value).toFixed(3))}
                onChange={(event) => { const numeric = event.target.valueAsNumber; if (!Number.isFinite(numeric) || property === "scale" && numeric <= 0) return;
                  const values = [...selected[property]] as [number, number, number]; values[axis] = property === "rotation" ? numeric * Math.PI / 180 : numeric;
                  commitPose(selected, { position: selected.position, rotation: selected.rotation, scale: selected.scale, [property]: values }); }} /></label>)}
            </div></fieldset>)}
            {recording && <p className="scene-note">{draft ? "Unsaved pose · press K to keep this change." : "Move the playhead, pose the object, then press K."}</p>}
          </>}
        </>}
        {drawer === "light" && <>
          <p className="scene-note">Lighting overrides belong to this shot.</p>
          <div className="scene-button-group">{(["3-point", "sunset", "neon", "interior practical"] as const).map((rig) => <button key={rig} disabled={!canEdit} aria-pressed={lightNode?.parameters.preset === rig} onClick={() => clip && dispatch({ type: "set-lighting-rig", clipId: clip.id, rig })}>{rig}</button>)}</div>
          {lightNode && <><label>Environment intensity<input type="range" min="0" max="5" step="0.05" value={lighting.intensity} disabled={!canEdit} onChange={(event) => dispatch({ type: "update-node-parameter", nodeId: lightNode.id, key: "intensity", value: Number(event.target.value) })} /></label>
            <label>Environment color<input type="color" value={lighting.color} disabled={!canEdit} onChange={(event) => dispatch({ type: "update-node-parameter", nodeId: lightNode.id, key: "color", value: event.target.value })} /></label></>}
          {objects.filter((object) => object.kind === "light").map((object) => <div key={object.id} className="scene-light-card"><button onClick={() => { select(object.id); setDrawer("layers"); }}>{object.name}</button>
            <label>Intensity<input type="range" min="0" max="20" step="0.1" value={object.intensity} disabled={!canEdit || object.locked} onChange={(event) => patchObject(object, { intensity: Number(event.target.value) })} /></label>
            <label>Color<input type="color" value={object.color} disabled={!canEdit || object.locked} onChange={(event) => patchObject(object, { color: event.target.value })} /></label>
          </div>)}
          <button disabled={!canEdit} onClick={() => setDrawer("assets")}>+ Add light</button>
        </>}
        {drawer === "camera" && <>
          <label>Lens · mm<input type="number" min="8" max="300" value={lens.focalLengthMm} disabled={!canEdit} onChange={(event) => updateLens("focalLengthMm", event.target.valueAsNumber)} /></label>
          <label>Focus · m<input type="number" min="0.1" step="0.1" value={lens.focusDistanceM ?? 3} disabled={!canEdit} onChange={(event) => updateLens("focusDistanceM", event.target.valueAsNumber)} /></label>
          <label>Aperture<input type="number" min="0.7" max="32" step="0.1" value={lens.aperture ?? 2.8} disabled={!canEdit} onChange={(event) => updateLens("aperture", event.target.valueAsNumber)} /></label>
          <p className="scene-note">Lens & focus are saved with poses. Depth of field requires a render backend.</p>
          <details><summary>Motion presets & interpolation</summary>
            <label>Camera movement<select defaultValue="" disabled={!canEdit} onChange={(event) => clip && dispatch({ type: "set-camera-rig", clipId: clip.id, rig: event.target.value as CameraRigPreset })}><option value="" disabled>Choose a movement</option>{CAMERA_RIG_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            <label>Interpolation<select value={cameraParams.interpolation} disabled={!canEdit || !cameraNode} onChange={(event) => cameraNode && dispatch({ type: "update-node-parameter", nodeId: cameraNode.id, key: "interpolation", value: event.target.value })}><option value="linear">Linear</option><option value="bezier">Ease in / out</option><option value="catmull_rom">Smooth path</option></select></label>
            <button disabled={!canEdit} onClick={() => clip && dispatch({ type: "trim-camera-keyframes", clipId: clip.id })}>Trim poses outside shot</button>
          </details>
          <button onClick={() => setResetSignal((value) => value + 1)}>Reset view</button>
        </>}
        {drawer === "settings" && <>
          <label>Output ratio<select value={ui.outputAspect} onChange={(event) => dispatch({ type: "set-output-aspect", aspect: event.target.value as OutputAspectPreset })}>{OUTPUT_ASPECT_PRESETS.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.label}</option>)}</select></label>
          <div className="scene-pipeline"><span>Editable world</span><span>Camera + object tracks</span><span>3D encoder → video model</span></div>
          <p className="scene-note">키프레임은 이미지가 아닌 3D 포즈입니다. 프리뷰 픽셀은 생성 입력에 포함되지 않습니다.</p>
          <button disabled={!canEdit} onClick={exportScene}><SceneIcon name="export" />Export scene recipe</button>
          <p className="scene-note">JSON은 latent 자체가 아닙니다. 호환되는 3D encoder / video backend 연결이 필요합니다.</p>
        </>}
      </aside>}
      <button className="scene-help-toggle" aria-label="Navigation help" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}><SceneIcon name="help" /></button>
      {showHelp && <div className="scene-help"><strong>{cameraView ? "Move the camera" : "Explore the scene"}</strong><p>{cameraView ? "WASD 이동 · Q/E 높이 · 우클릭 드래그 시선 · Shift 빠르게" : "Orbit: 드래그 회전 · 휠 줌 · 우클릭 이동 · W/E/R 변형 · F 선택 보기"}</p><p>Motion: K 포즈 저장 · Space 재생 · Esc 패널 닫기</p></div>}
    </div>
    {recording && <SceneTimeline tracks={tracks} activeId={selectedId} frame={frame} duration={duration} fps={fps} playing={playing} onSelect={select} onScrub={scrub}
      onPlay={() => { setDraft(undefined); if (frame >= duration - 1) scrub(0); setPlaying((value) => !value); }} onKey={stamp} onDelete={deletePose} disabled={!canEdit || Boolean(selected?.locked)} />}
    <footer className="scene-status"><span>{previewOnly ? "Preview only · editing disabled" : notice || (draft ? "Unsaved object pose · K to save" : world ? `${world.name} · shared world / local shot` : "Persistent world · editable shot")}</span><span>{fps} fps · {ui.outputAspect}</span></footer>
  </section>;
};
