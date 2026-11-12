import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, type ViewportTool } from "../../state/editorStore";
import { StageViewport, type StageCameraPose, type ViewportSelection } from "./StageViewport";
import { SceneIcon, type SceneIconName } from "./SceneIcon";
import { SceneTimeline } from "./SceneTimeline";
import { SceneAssets } from "./SceneAssets";
import { type CameraKeyframe } from "../../domain/graph/cameraPath";
import { verticalFovFromLens } from "../../domain/graph/lens";
import { buildRigPreset, CAMERA_RIG_PRESETS, type CameraRigPreset } from "../../domain/graph/cameraRig";
import { clipStartFrame } from "../../domain/timeline/timing";
import { firstViewportImageUri, resolveViewportRepresentation, type ViewportLoadState } from "../../domain/worlds/viewportRepresentation";
import { eulerToQuaternionApprox, quaternionToEulerApprox } from "../../application/services/viewportCommit";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import { type ObjectPose } from "../../domain/worlds/sceneObjects";
import { OUTPUT_ASPECT_PRESETS, outputAspectRatio, type OutputAspectPreset } from "../../domain/rendering";
import {
  clipLocalFrame,
  prepareModelInput,
  sampleCameraPathPositions,
  sampleCameraPose,
  sampleSubjectPose,
  selectedTake,
  shotId,
  subjectId,
  takeId,
  subjectPoseKeys,
  type Lens,
  type ShotCommand,
} from "../../domain/shot";
import type { SceneObject } from "../../domain/worlds/sceneObjects";
import { subjectDraftFromObject } from "./subjectDraft";
import { InteractionPreview } from "../../presentation/scene/InteractionPreview";
import { HANDSHAKE_SHOT_ID } from "../../domain/sceneAuthoring";
import "./sceneWorkspace.css";

const tuple3 = (value: readonly [number, number, number]): [number, number, number] => [value[0], value[1], value[2]];
const tuple4 = (value: readonly [number, number, number, number]): [number, number, number, number] => [value[0], value[1], value[2], value[3]];
import { createLoopClock } from "../../application/ports/LoopClock";
import { validateOutputAspect } from "./recordingPreflight";

type LivePose = { position: [number, number, number]; rotation: [number, number, number] };

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
  const [interaction, setInteraction] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [takeRecording, setTakeRecording] = useState(false);
  const loopRef = useRef<ReturnType<typeof createLoopClock> | null>(null);
  const takeRef = useRef<Map<number, LivePose>>(new Map());
  const takeRecordingRef = useRef(false);
  const takeFinishingRef = useRef(false);
  const livePoseRef = useRef<LivePose | null>(null);
  const lensRef = useRef<Lens>({ focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 });
  const playbackRef = useRef({ duration: 1, start: 0, fps: 24, clipId: "" });
  const finishTakeRecordingRef = useRef<(reason: "stop" | "complete") => void>(() => undefined);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [draft, setDraft] = useState<{ id: string; pose: ObjectPose }>();
  const [load, setLoad] = useState<{ state: ViewportLoadState; message?: string }>({ state: "idle" });
  const [notice, setNotice] = useState("");
  const [selectedFrames, setSelectedFrames] = useState<number[]>([]);
  const shot = clip ? project.shots?.[clip.id] : undefined;
  const duration = shot?.time.durationFrames ?? 1;
  const start = clip ? clipStartFrame(clip) : 0;
  const frame = shot ? clipLocalFrame((sequence?.playhead ?? start) - start, shot) : 0;
  const fps = shot?.time.fps ?? 24;
  playbackRef.current = { duration, start, fps, clipId: clip?.id ?? "" };
  const subjects = shot && !previewOnly ? shot.subjects : [];
  const objects = useMemo(() => subjects.map((subject) => {
    const pose = recording ? sampleSubjectPose(subject, frame) : subject.placement;
    return {
      id: subject.id,
      name: subject.name,
      kind: subject.kind === "human" ? "actor" as const : subject.kind === "light" ? "light" as const : "prop" as const,
      representation: subject.kind === "light" ? "marker" as const : subject.representation,
      uri: subject.uri.startsWith("primitive:") ? undefined : subject.uri,
      position: tuple3(pose.position),
      rotation: tuple3(pose.rotationEuler),
      scale: tuple3(pose.scale),
      visible: subject.visible,
      locked: subject.locked,
      color: subject.kind === "light" ? subject.color : "#d8d2c4",
      intensity: subject.kind === "light" ? subject.intensity : 2,
      posePrompt: subject.kind !== "light" && subject.motion.channel === "text" ? subject.motion.prompt : undefined,
    };
  }), [subjects, recording, frame]);
  const take = shot ? selectedTake(shot) : undefined;
  const cameraParams = {
    keyframes: (take?.keys ?? []).map((key) => ({ ...key, position: tuple3(key.position), rotation: tuple4(key.rotation) })),
    takes: shot?.camera.status === "ready" ? shot.camera.takes : [],
    activeTakeId: shot?.camera.status === "ready" ? shot.camera.selectedTakeId : undefined,
    interpolation: shot?.camera.interpolation ?? "linear" as const,
    lookAtTargetElementId: undefined as string | undefined,
  };
  const lens = shot?.camera.lens ?? { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 };
  lensRef.current = lens;
  takeRecordingRef.current = takeRecording;
  const cameraPose = useMemo((): StageCameraPose | undefined => {
    if (!shot || !take || shot.camera.status !== "ready") return undefined;
    const pose = sampleCameraPose(take, frame, shot.camera.interpolation);
    return { position: tuple3(pose.position), rotation: quaternionToEulerApprox(tuple4(pose.rotation)), focalLength: pose.focalLengthMm || lens.focalLengthMm };
  }, [shot, take, frame, lens.focalLengthMm]);
  const sceneObjects = useMemo(() => objects.map((object) => ({
    ...object,
    ...(draft?.id === object.id ? draft.pose : undefined),
  })), [objects, draft]);
  const selected = sceneObjects.find((object) => object.id === selectedId);
  const canEdit = Boolean(shot && clip && !previewOnly);
  const cameraView = recording && !freeView && selectedId === "camera";
  const previewPlan = useMemo(() => resolveViewportRepresentation(world), [world]);
  const fallbackImageUri = useMemo(() => firstViewportImageUri(world, project.assets), [world, project.assets]);
  const pathSamples = useMemo(() => (shot ? sampleCameraPathPositions(shot, 64) : []).map(tuple3), [shot]);
  const lighting = useMemo(() => {
    const light = subjects.find((subject) => subject.kind === "light");
    return light && light.kind === "light"
      ? { intensity: light.intensity, color: light.color }
      : { intensity: 1.2, color: "#ffffff" };
  }, [subjects]);
  const tracks = [
    { id: "camera", name: "Camera", frames: cameraParams.keyframes.map((key) => key.frame) },
    ...subjects.map((subject) => ({ id: subject.id, name: subject.name, frames: [...subjectPoseKeys(subject)] })),
  ];
  const send = (command: ShotCommand) => { if (shot) dispatch({ type: "shot", command }); };
  const select = (id: string) => {
    setSelectedId(id);
    setDraft(undefined);
    setSelectedFrames([]);
    if (id !== "camera") dispatch({ type: "set-viewport-tool", tool: "translate" });
  };
  const scrub = (value: number) => { setDraft(undefined); dispatch({ type: "scrub-playhead", playhead: start + value }); };
  const patchObject = (object: SceneObject, patch: Record<string, unknown>) => {
    if (!shot || !canEdit || object.locked && !("locked" in patch)) return;
    if ("posePrompt" in patch) {
      send({ type: "SET_TEXT_POSE", shotId: shot.id, subjectId: subjectId(object.id), prompt: String(patch.posePrompt ?? "") });
    }
    if ("visible" in patch || "locked" in patch) {
      send({
        type: "SET_SUBJECT_FLAGS",
        shotId: shot.id,
        subjectId: subjectId(object.id),
        visible: "visible" in patch ? Boolean(patch.visible) : undefined,
        locked: "locked" in patch ? Boolean(patch.locked) : undefined,
      });
    }
    if (object.kind === "light" && ("intensity" in patch || "color" in patch)) {
      send({
        type: "SET_LIGHT",
        shotId: shot.id,
        subjectId: subjectId(object.id),
        intensity: typeof patch.intensity === "number" ? patch.intensity : undefined,
        color: typeof patch.color === "string" ? patch.color : undefined,
      });
    }
  };
  const commitPose = (object: SceneObject, pose: ObjectPose) => {
    if (!shot || !canEdit || object.locked) return;
    if (recording) setDraft({ id: object.id, pose });
    else send({ type: "SET_SUBJECT_PLACEMENT", shotId: shot.id, subjectId: subjectId(object.id), placement: { position: pose.position, rotationEuler: pose.rotation, scale: pose.scale } });
  };
  const captureCamera = useCallback(({ camera }: { camera: StageCameraPose }) => {
    if (!shot || previewOnly) return;
    dispatch({
      type: "shot",
      command: {
        type: "KEY_CAMERA",
        shotId: shot.id,
        key: {
          frame,
          position: camera.position,
          rotation: eulerToQuaternionApprox(camera.rotation),
          focalLengthMm: lens.focalLengthMm,
          focusDistanceM: lens.focusDistanceM,
          aperture: lens.aperture,
        },
      },
    });
    setNotice(`Camera pose saved · ${frame}f`);
  }, [shot, previewOnly, frame, dispatch, lens.focalLengthMm, lens.focusDistanceM, lens.aperture]);
  const stamp = () => {
    if (!canEdit || !shot || playing || takeRecording) return;
    if (selected) {
      if (selected.locked || selected.kind === "light") return;
      send({
        type: "KEY_SUBJECT_POSE",
        shotId: shot.id,
        subjectId: subjectId(selected.id),
        key: { frame, position: selected.position, rotationEuler: selected.rotation, scale: selected.scale },
      });
      setDraft(undefined); setNotice(`${selected.name} pose saved · ${frame}f`);
    } else setCaptureSignal((value) => value + 1);
  };
  const finishTakeRecording = useCallback((reason: "stop" | "complete") => {
    const clipId = playbackRef.current.clipId;
    if (!clipId || takeFinishingRef.current) return;
    takeFinishingRef.current = true;
    takeRecordingRef.current = false;
    const lensParams = lensRef.current;
    const live = livePoseRef.current;
    if (live && takeRef.current.size > 0) {
      const last = Math.max(...takeRef.current.keys());
      takeRef.current.set(last, live);
    }
    const keyframes: CameraKeyframe[] = Array.from(takeRef.current.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, pose]) => ({
        frame: t,
        position: pose.position,
        rotation: eulerToQuaternionApprox(pose.rotation),
        focalLengthMm: lensParams.focalLengthMm,
        focusDistanceM: lensParams.focusDistanceM,
        aperture: lensParams.aperture,
      }));
    takeRef.current.clear();
    setTakeRecording(false);
    setPlaying(false);
    if (keyframes.length === 0) {
      setNotice(reason === "complete" ? "Record finished with no poses." : "Record cancelled.");
      return;
    }
    const first = keyframes[0];
    const spanFrames = keyframes[keyframes.length - 1].frame - first.frame + 1;
    dispatch({ type: "shot", command: { type: "COMMIT_CAMERA_TAKE", shotId: shotId(clipId), source: "record", keys: [first, ...keyframes.slice(1)] } });
    setNotice(`Take saved · ${keyframes.length} poses · ${spanFrames}f · selected for Generate`);
  }, [dispatch]);
  finishTakeRecordingRef.current = finishTakeRecording;
  const deletePose = () => {
    if (!shot || !canEdit || playing) return;
    const targets = selectedFrames.length > 0 ? [...selectedFrames].sort((a, b) => a - b) : [frame];
    if (selected) {
      targets.forEach((target) =>
        send({ type: "DELETE_SUBJECT_POSE_KEY", shotId: shot.id, subjectId: subjectId(selected.id), frame: target }),
      );
      setNotice(
        targets.length > 1
          ? `${selected.name}: deleted ${targets.length} poses`
          : `${selected.name} pose deleted · ${targets[0]}f`,
      );
    } else {
      targets.forEach((target) => send({ type: "DELETE_CAMERA_KEY", shotId: shot.id, frame: target }));
      setNotice(
        targets.length > 1
          ? `Deleted ${targets.length} camera poses`
          : `Camera pose deleted · ${targets[0]}f`,
      );
    }
    setSelectedFrames([]);
    setDraft(undefined);
  };
  const switchMode = (mode: "build" | "record") => {
    if (takeRecording) finishTakeRecording("stop");
    setPlaying(false); setDraft(undefined); setDrawer(null); setNotice(""); setSelectedFrames([]);
    setInteraction(false);
    dispatch({ type: "set-viewport-workspace", workspace: mode });
  };
  const openInteraction = () => {
    setInteraction(true);
    dispatch({
      type: "agent-execute-commands",
      commands: [{ type: "INSTALL_INTERACTION_SCENE" }],
      logMessage: "악수 상호작용 프리뷰를 열었습니다.",
    });
  };
  const changeHandshakeHand = (rigPart: "left_hand" | "right_hand") => {
    dispatch({
      type: "agent-execute-commands",
      commands: [{
        type: "CHANGE_CONTACT_EFFECTOR",
        shotId: HANDSHAKE_SHOT_ID,
        subjectRef: "B",
        locale: "ko",
        contactId: "handshake_01",
        rigPart,
      }],
      logMessage: rigPart === "left_hand"
        ? "B의 악수 손을 왼손으로 바꿨습니다. 카메라, 배경, A의 이동은 그대로입니다."
        : "B의 악수 손을 오른손으로 바꿨습니다. 카메라, 배경, A의 이동은 그대로입니다.",
    });
  };
  useEffect(() => {
    setSelectedId("camera");
    setDraft(undefined);
    setPlaying(false);
    setTakeRecording(false);
    takeFinishingRef.current = false;
    takeRef.current.clear();
    livePoseRef.current = null;
    setNotice("");
    setSelectedFrames([]);
  }, [clip?.id, world?.id]);
  useEffect(() => {
    if (!recording) {
      if (takeRecordingRef.current) finishTakeRecording("stop");
      setPlaying(false);
    }
  }, [recording, finishTakeRecording]);
  // Play/Record clock must NOT restart when scrub updates project (new clip object
  // identity). Only `playing` may remount the clock; timing is read from refs.
  useEffect(() => {
    if (!playing) {
      loopRef.current?.stop();
      loopRef.current = null;
      return;
    }
    const { duration: totalFramesRaw, start: clipStart, fps: clipFps } = playbackRef.current;
    const totalFrames = Math.max(1, totalFramesRaw);
    const fpsSafe = Math.max(1, clipFps);
    const loop = createLoopClock({
      duration: Math.max(0.001, totalFrames / fpsSafe),
      fps: fpsSafe,
      autoplay: true,
      // Record is one pass through the shot; Play may loop.
      loop: !takeRecordingRef.current,
    });
    loopRef.current = loop;
    let lastStamped = -1;
    let reachedEnd = false;
    const stampTakeFrame = (localFrame: number) => {
      if (!takeRecordingRef.current || takeFinishingRef.current) return;
      const pose = livePoseRef.current;
      if (!pose) return;
      const sample = { position: [...pose.position] as LivePose["position"], rotation: [...pose.rotation] as LivePose["rotation"] };
      if (lastStamped >= 0 && localFrame > lastStamped + 1) {
        const hold = takeRef.current.get(lastStamped) ?? sample;
        for (let frameIndex = lastStamped + 1; frameIndex < localFrame; frameIndex += 1) {
          takeRef.current.set(frameIndex, hold);
        }
      }
      takeRef.current.set(localFrame, sample);
      lastStamped = localFrame;
    };
    stampTakeFrame(0);
    const unsub = loop.subscribe((tSec) => {
      const next = Math.max(0, Math.min(totalFrames - 1, Math.floor(tSec * fpsSafe)));
      stampTakeFrame(next);
      dispatch({ type: "scrub-playhead", playhead: clipStart + next });
      if (takeRecordingRef.current && !reachedEnd && next >= totalFrames - 1) {
        reachedEnd = true;
        stampTakeFrame(totalFrames - 1);
        finishTakeRecordingRef.current("complete");
      }
    });
    return () => {
      unsub();
      loop.stop();
      loopRef.current = null;
    };
  }, [playing, dispatch]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const deleting = key === "backspace" || key === "delete";
      const inTextField =
        event.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable);
      if (inTextField) return;
      if (!deleting && typing(event.target)) return;
      if ((!alwaysActive && ui.panelTab !== "viewport") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest(".assistant-panel, .timeline-panel-compact, .top-bar")) return;
      if (key === "k" && recording && !takeRecording) { event.preventDefault(); stamp(); }
      if (key === " " && recording && canEdit && !takeRecording) {
        event.preventDefault();
        setDraft(undefined);
        setPlaying((value) => !value);
      }
      if (deleting && recording && canEdit && !playing && !takeRecording) {
        event.preventDefault();
        deletePose();
        return;
      }
      if (key === "escape") {
        if (takeRecording) {
          event.preventDefault();
          finishTakeRecording("stop");
          return;
        }
        setDrawer(null);
        setDraft(undefined);
        setPlaying(false);
        setSelectedFrames([]);
      }
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
    if (!shot || !canEdit) return;
    const prepared = prepareModelInput(shot, environmentFromWorld(world), ui.outputAspect);
    const body = prepared.ok ? prepared.input : { blocked: prepared.blocker };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${shot.id}.scene.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(prepared.ok ? "Shot model input exported." : prepared.blocker.message);
  };
  const toggleDrawer = (value: Drawer) => setDrawer((current) => current === value ? null : value);
  const updateLens = (key: "focalLengthMm" | "focusDistanceM" | "aperture", value: number) => {
    if (shot && Number.isFinite(value)) send({ type: "SET_LENS", shotId: shot.id, lens: { ...shot.camera.lens, [key]: value } });
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
        <button aria-pressed={interaction} onClick={() => (interaction ? setInteraction(false) : openInteraction())}>상호작용</button>
      </div>
    </header>
    <div className="scene-stage-area">
      {interaction && (
        <InteractionPreview project={project} onClose={() => setInteraction(false)} onChangeHand={changeHandshakeHand} />
      )}
      <div className={`scene-stage-canvas ${cameraView ? "is-camera-view" : ""}`} style={{ "--scene-aspect": outputAspectRatio(ui.outputAspect) } as React.CSSProperties}>
        <StageViewport world={world} worldName={world?.name} previewPlan={previewPlan} fallbackImageUri={fallbackImageUri}
          overlays={ui.viewportOverlays} tool={ui.viewportTool} workspace={cameraView ? "record" : "build"}
          outputAspect={outputAspectRatio(ui.outputAspect)} outputAspectLabel={ui.outputAspect}
          cameraViz={recording ? ui.cameraViz : { frustum: false, path: false, lookAtLine: false, keyframeMarkers: false }}
          cameraPose={takeRecording ? undefined : cameraPose} sceneObjects={sceneObjects} selectedId={selectedId === "camera" ? undefined : selectedId}
          showCameraPreview={showPreview && !cameraView} readOnly={!canEdit || playing || takeRecording} lighting={lighting}
          keyframes={cameraParams.keyframes} pathSamples={pathSamples} fovDegrees={verticalFovFromLens({ focalLengthMm: cameraPose?.focalLength ?? lens.focalLengthMm, sensorPreset: lens.sensorPreset === "super35" || lens.sensorPreset === "micro-four-thirds" ? lens.sensorPreset : "full-frame" })}
          playheadFrame={frame} lookAtTargetId={cameraParams.lookAtTargetElementId}
          onSelectionChange={(selection: ViewportSelection | undefined) => { if (selection && selection.kind !== "camera") { setSelectedId(selection.id); setDrawer("layers"); } }}
          onTransformCommit={(payload) => {
            if (!shot || !canEdit || takeRecording) return;
            if (payload.kind === "camera") {
              send({
                type: "KEY_CAMERA",
                shotId: shot.id,
                key: {
                  frame,
                  position: payload.position,
                  rotation: eulerToQuaternionApprox(payload.rotation),
                  focalLengthMm: lens.focalLengthMm,
                  focusDistanceM: lens.focusDistanceM,
                  aperture: lens.aperture,
                },
              });
              return;
            }
            const object = sceneObjects.find((item) => item.id === payload.worldElementId);
            if (object) commitPose(object, { position: payload.position, rotation: payload.rotation, scale: payload.scale ?? object.scale });
          }}
          onLoadStateChange={(state, message) => setLoad({ state, message })}
          onCapturePose={captureCamera}
          onLiveCameraPose={(camera) => {
            livePoseRef.current = { position: camera.position, rotation: camera.rotation };
          }}
          captureSignal={captureSignal} focusSignal={focusSignal} resetSignal={resetSignal} />
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
        {drawer === "assets" && <SceneAssets disabled={!canEdit} onAdd={(object) => { if (shot) { send({ type: "ADD_SUBJECT", shotId: shot.id, draft: subjectDraftFromObject(object) }); select(object.id); setDrawer("layers"); } }} />}
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
            <label>Camera movement<select defaultValue="" disabled={!canEdit} onChange={(event) => {
              if (!shot || !event.target.value) return;
              const built = buildRigPreset({ preset: event.target.value as CameraRigPreset, durationFrames: duration, start: { position: cameraPose?.position ?? [0, 1.6, 4], rotation: cameraPose?.rotation ?? [0, 0, 0] }, focalLengthMm: lens.focalLengthMm });
              const first = built.keyframes[0];
              if (!first) return;
              send({ type: "APPLY_CAMERA_PRESET", shotId: shot.id, keys: [first, ...built.keyframes.slice(1)] });
            }}><option value="" disabled>Choose a movement</option>{CAMERA_RIG_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            <label>Interpolation<select value={cameraParams.interpolation} disabled={!canEdit} onChange={(event) => { if (shot && (event.target.value === "linear" || event.target.value === "catmull_rom")) send({ type: "SET_CAMERA_INTERPOLATION", shotId: shot.id, interpolation: event.target.value }); }}><option value="linear">Linear</option><option value="catmull_rom">Smooth path</option></select></label>
            <button disabled={!canEdit} onClick={() => shot && send({ type: "TRIM_KEYS", shotId: shot.id })}>Trim poses outside shot</button>
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
      {showHelp && (
        <div className="scene-help">
          <strong>{cameraView ? "Move the camera" : "Explore the scene"}</strong>
          {cameraView ? (
            <p>WASD 이동 · Q/E 높이 · ←→ yaw · ↑↓ pitch · Z/X roll · Shift 빠르게 · 우클릭 드래그도 시선</p>
          ) : (
            <p>Orbit: 드래그 회전 · 휠 줌 · 우클릭 이동 · F 선택 보기</p>
          )}
          <p>
            <strong>Rotate / Scale 툴</strong>은 카메라용이 아닙니다. 하단 W/E/R(이동·회전·크기)은
            배우·소품을 골랐을 때 기즈모로 바꾸는 도구입니다. 카메라 시선은 Camera view의 화살표·Z/X를 쓰세요.
          </p>
          <p>Motion: Record로 Take 저장 · Play는 선택 Take 미리보기 · K는 희소 포즈 · Generate는 선택 Take 사용</p>
        </div>
      )}
    </div>
    {recording && <SceneTimeline
      tracks={tracks}
      activeId={selectedId}
      frame={frame}
      duration={duration}
      fps={fps}
      playing={playing}
      takeRecording={takeRecording}
      takes={cameraParams.takes.map((take) => ({
        id: take.id,
        name: take.name,
        keyCount: take.keys.length,
        source: take.source,
      }))}
      activeTakeId={cameraParams.activeTakeId}
      selectedFrames={selectedFrames}
      onSelect={select}
      onScrub={scrub}
      onSelectedFramesChange={setSelectedFrames}
      onSelectTake={(id) => shot && send({ type: "SELECT_CAMERA_TAKE", shotId: shot.id, takeId: takeId(id) })}
      onDeleteTake={(id) => shot && send({ type: "DELETE_CAMERA_TAKE", shotId: shot.id, takeId: takeId(id) })}
      onPlay={() => {
        if (takeRecording) return;
        setDraft(undefined);
        setSelectedFrames([]);
        if (frame >= duration - 1) scrub(0);
        if (!playing) {
          if (!validateOutputAspect(ui.outputAspect)) {
            setNotice("Choose a valid output aspect before playback.");
            return;
          }
          setFreeView(false);
          setNotice(
            cameraParams.activeTakeId
              ? `Preview · ${cameraParams.takes.find((take) => take.id === cameraParams.activeTakeId)?.name ?? "selected take"}`
              : "Preview · no take selected yet",
          );
        }
        setPlaying((value) => !value);
      }}
      onRecord={() => {
        if (!clip || !canEdit) return;
        if (takeRecording) {
          finishTakeRecording("stop");
          return;
        }
        if (!validateOutputAspect(ui.outputAspect)) {
          setNotice("Choose a valid output aspect before recording.");
          return;
        }
        takeRef.current.clear();
        takeFinishingRef.current = false;
        if (!livePoseRef.current && cameraPose) {
          livePoseRef.current = { position: cameraPose.position, rotation: cameraPose.rotation };
        }
        setSelectedFrames([]);
        setDraft(undefined);
        setSelectedId("camera");
        setFreeView(false);
        scrub(0);
        takeRecordingRef.current = true;
        setTakeRecording(true);
        setPlaying(true);
        setNotice(`Recording take · ${duration}f @ ${fps} fps · move the camera`);
      }}
      onKey={stamp}
      onDelete={deletePose}
      disabled={!canEdit || Boolean(selected?.locked)}
    />}
    <footer className="scene-status"><span>{previewOnly ? "Preview only · editing disabled" : notice || (draft ? "Unsaved object pose · K to save" : world ? `${world.name} · shared world / local shot` : "Persistent world · editable shot")}</span><span>{cameraParams.activeTakeId ? `${cameraParams.takes.find((take) => take.id === cameraParams.activeTakeId)?.name ?? "Take"} · ${cameraParams.keyframes.length} keys` : "No take"} · {fps} fps · {ui.outputAspect}</span></footer>
  </section>;
};
