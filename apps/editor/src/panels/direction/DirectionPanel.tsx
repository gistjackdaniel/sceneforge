import { useRef, useState, type ChangeEvent } from "react";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import {
  validateCameraContinuity,
  type ContinuityActorAnchor,
} from "../../domain/graph/continuity";
import { lensNodeIdForClip, lensParamsFromNode } from "../../domain/graph/lens";
import {
  PERFORMANCE_CUE_KINDS,
  PERFORMANCE_QUALITY_STATUSES,
  PERFORMANCE_SOURCE_TYPES,
  performancePlanFromNode,
  performancePlanNodeIdForClip,
  validatePerformancePlan,
  type PerformanceCue,
  type PerformanceCueKind,
  type PerformancePlanParams,
  type PerformanceQualityGate,
  type PerformanceSource,
  type PerformanceSourceType,
} from "../../domain/performance";
import {
  DIRECTION_CHANNEL_LABELS,
  type DirectionChannel,
  type DirectionChannelControl,
} from "../../domain/direction";
import {
  negotiateDirectionCapabilities,
  type DirectionChannelCapability,
} from "../../domain/rendering/capabilities";
import { LYRA_DIRECTION_CAPABILITIES } from "../../core/lyra/capabilities";
import {
  exportPerformancePlanToEdl,
  exportPerformancePlanToOtio,
  exportPerformancePlanToPremiereXml,
  importEditorialTimingFile,
  serializeOtio,
} from "../../domain/editorial";
import { clipDurationFrames, clipStartFrame } from "../../domain/timeline/timing";
import { useEditorStore } from "../../state/editorStore";
import { downloadTextFile, editorialFilename } from "../editorialDownload";

const SOURCE_LABELS: Record<PerformanceSourceType, string> = {
  text_prompt: "Text direction",
  live_action: "Live-action performance",
  motion_capture: "Motion capture",
  key_animation_2d: "Hand-drawn 2D keys",
};

const CUE_LABELS: Record<PerformanceCueKind, string> = {
  dialogue: "Dialogue",
  reaction: "Reaction",
  action: "Action",
  hold: "Hold / pause",
};

const makeId = (prefix: string): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now().toString(36)}`;

const CHANNEL_HELP: Record<DirectionChannel, string> = {
  camera: "Framing, path, speed, lens",
  structure: "World and static staging anchors",
  performance_body: "Gesture, weight, action mechanics",
  performance_face: "Expression, gaze, speech performance",
  audio: "Edited dialogue and beat timing",
};

const vectorFromParameter = (value: unknown): [number, number, number] | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number"
    ? [record.x, record.y, record.z]
    : undefined;
};

const DirectionControlEditor = ({
  control,
  capability,
  onChange,
}: {
  control: DirectionChannelControl;
  capability: DirectionChannelCapability;
  onChange: (patch: Partial<DirectionChannelControl>) => void;
}) => (
  <div className={`direction-control-row capability-${capability.mode}`}>
    <div className="direction-control-name">
      <strong>{DIRECTION_CHANNEL_LABELS[control.channel]}</strong>
      <span>{CHANNEL_HELP[control.channel]}</span>
    </div>
    <span className="capability-badge">{capability.mode}</span>
    <label className="inline-check direction-lock-control">
      <input
        type="checkbox"
        checked={control.locked}
        disabled={!capability.supportsLock}
        onChange={(event) => onChange({ locked: event.target.checked })}
      />
      Lock
    </label>
    <label className="direction-strength-control">
      <span>{Math.round(control.strength * 100)}%</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={control.strength}
        disabled={!capability.supportsStrength}
        onChange={(event) => onChange({ strength: Number(event.target.value) })}
      />
    </label>
    {capability.supportsMask && (
      <input
        className="direction-mask-input"
        value={control.mask?.uri ?? ""}
        placeholder="Optional mask URI"
        aria-label={`${DIRECTION_CHANNEL_LABELS[control.channel]} mask URI`}
        onChange={(event) =>
          onChange({ mask: event.target.value ? { uri: event.target.value } : undefined })
        }
      />
    )}
  </div>
);

const PerformanceQualityEditor = ({
  source,
  onChange,
}: {
  source: PerformanceSource;
  onChange: (qualityGate: PerformanceQualityGate) => void;
}) => {
  if (source.type !== "live_action" && source.type !== "motion_capture") {
    return null;
  }
  const quality = source.qualityGate ?? { status: "unreviewed" as const };
  const setPercent = (
    key: "trackingConfidence" | "contactConfidence" | "footSlidingScore",
    value: string,
  ) => onChange({ ...quality, [key]: value === "" ? undefined : Number(value) / 100 });
  return (
    <div className="performance-quality-gate">
      <div className="quality-gate-heading">
        <span className="label">Capture quality gate</span>
        <select
          value={quality.status}
          onChange={(event) =>
            onChange({
              ...quality,
              status: event.target.value as PerformanceQualityGate["status"],
            })
          }
        >
          {PERFORMANCE_QUALITY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      <div className="quality-score-grid">
        <label>
          Tracking %
          <input type="number" min={0} max={100} value={quality.trackingConfidence === undefined ? "" : Math.round(quality.trackingConfidence * 100)} onChange={(event) => setPercent("trackingConfidence", event.target.value)} />
        </label>
        <label>
          Contact %
          <input type="number" min={0} max={100} value={quality.contactConfidence === undefined ? "" : Math.round(quality.contactConfidence * 100)} onChange={(event) => setPercent("contactConfidence", event.target.value)} />
        </label>
        <label>
          Foot slide %
          <input type="number" min={0} max={100} value={quality.footSlidingScore === undefined ? "" : Math.round(quality.footSlidingScore * 100)} onChange={(event) => setPercent("footSlidingScore", event.target.value)} />
        </label>
      </div>
    </div>
  );
};

export const DirectionPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const [sourceType, setSourceType] = useState<PerformanceSourceType>("text_prompt");
  const [cueKind, setCueKind] = useState<PerformanceCueKind>("dialogue");
  const [editorialMessage, setEditorialMessage] = useState("");
  const editorialInputRef = useRef<HTMLInputElement>(null);

  const clip = project.clips[ui.selectedClipId];
  const sequence = project.sequences[project.activeSequenceId];
  if (!clip || !sequence) {
    return <section className="panel direction-panel">Select a clip to author direction.</section>;
  }

  const durationFrames = clipDurationFrames(clip);
  const localFrame = Math.max(0, Math.min(durationFrames - 1, sequence.playhead - clipStartFrame(clip)));
  const graph = project.clipGraphs[clip.clipGraphId];
  const cameraNodeId = clip.cameraPathNodeId ?? `node-${clip.id}-trajectory`;
  const cameraNode = project.nodes[cameraNodeId];
  const cameraParams = cameraPathParamsFromNode(cameraNode?.parameters ?? {});
  const lens = lensParamsFromNode(project.nodes[lensNodeIdForClip(clip.id)]?.parameters ?? {});
  const performanceNodeId = clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
  const performanceNode = project.nodes[performanceNodeId];
  const plan = performancePlanFromNode(performanceNode?.parameters);
  const world = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
  const continuity = cameraParams.continuity ?? {
    lineOfActionLabel: "",
    cameraSide: "unlocked" as const,
    screenDirection: "neutral" as const,
  };
  const actorAnchors: ContinuityActorAnchor[] = (graph?.nodeIds ?? []).flatMap((nodeId) => {
    const node = project.nodes[nodeId];
    if (!node || node.kind !== "ActorPlacementNode") {
      return [];
    }
    const position = vectorFromParameter(node.parameters.position);
    if (!position) {
      return [];
    }
    const id =
      typeof node.parameters.worldElementId === "string"
        ? node.parameters.worldElementId
        : typeof node.parameters.mark === "string"
          ? node.parameters.mark
          : node.id;
    return [{ id, label: `${node.name || "Actor"} · ${id}`, position }];
  });
  const continuityValidation = validateCameraContinuity(
    cameraParams.keyframes.map((keyframe) => ({ frame: keyframe.frame, position: keyframe.position })),
    actorAnchors,
    cameraParams.continuity,
  );
  const validation = validatePerformancePlan(
    plan,
    durationFrames,
    actorAnchors.map((actor) => actor.id),
  );
  const hasAuthoredPerformance =
    plan.sources.some((source) => source.enabled) ||
    plan.cues.length > 0 ||
    Boolean(plan.audioGuide?.uri || plan.audioGuide?.assetId);
  const directionStatusLabel = !validation.ok
    ? `${validation.errors.length} timing error(s)`
    : hasAuthoredPerformance
      ? "Contract ready"
      : actorAnchors.length > 0
        ? "Generic acting only"
        : "Performance optional";
  const capabilityNegotiation = negotiateDirectionCapabilities(
    plan.channelControls,
    LYRA_DIRECTION_CAPABILITIES,
    {
      performanceSourceTypes: plan.sources.filter((source) => source.enabled).map((source) => source.type),
      hasFrameAccurateCues: plan.cues.length > 0,
      hasEditedAudio: Boolean(plan.audioGuide?.uri || plan.audioGuide?.assetId),
    },
  );

  const commitPlan = (next: PerformancePlanParams) => {
    dispatch({ type: "set-performance-plan", clipId: clip.id, plan: next });
  };

  const updateSource = (sourceId: string, patch: Partial<PerformanceSource>) => {
    commitPlan({
      ...plan,
      sources: plan.sources.map((source) =>
        source.id === sourceId ? { ...source, ...patch } : source,
      ),
    });
  };

  const removeSource = (sourceId: string) => {
    commitPlan({
      ...plan,
      sources: plan.sources.filter((source) => source.id !== sourceId),
      cues: plan.cues.map((cue) =>
        cue.sourceId === sourceId ? { ...cue, sourceId: undefined } : cue,
      ),
    });
  };

  const addSource = () => {
    const source: PerformanceSource = {
      id: makeId("perf-source"),
      type: sourceType,
      label: SOURCE_LABELS[sourceType],
      notes: sourceType === "text_prompt" ? "Describe the gesture, expression, rhythm, and intention." : undefined,
      enabled: true,
      qualityGate:
        sourceType === "live_action" || sourceType === "motion_capture"
          ? { status: "unreviewed" }
          : undefined,
    };
    commitPlan({ ...plan, sources: [...plan.sources, source] });
  };

  const updateCue = (cueId: string, patch: Partial<PerformanceCue>) => {
    commitPlan({
      ...plan,
      cues: plan.cues.map((cue) => (cue.id === cueId ? { ...cue, ...patch } : cue)),
    });
  };

  const addCue = () => {
    const startFrame = localFrame;
    const endFrame = Math.min(durationFrames, startFrame + Math.min(12, durationFrames));
    const cue: PerformanceCue = {
      id: makeId("perf-cue"),
      kind: cueKind,
      label: CUE_LABELS[cueKind],
      direction: "",
      startFrame,
      endFrame: Math.max(startFrame + 1, endFrame),
      sourceId: plan.sources.find((source) => source.enabled)?.id,
    };
    commitPlan({ ...plan, cues: [...plan.cues, cue] });
  };

  const updateContinuity = (patch: Partial<typeof continuity>) => {
    if (!cameraNode) {
      return;
    }
    dispatch({
      type: "update-node-parameter",
      nodeId: cameraNode.id,
      key: "continuity",
      value: { ...continuity, ...patch },
    });
  };

  const updateChannelControl = (
    channel: DirectionChannel,
    patch: Partial<DirectionChannelControl>,
  ) => {
    commitPlan({
      ...plan,
      channelControls: {
        ...plan.channelControls,
        [channel]: { ...plan.channelControls[channel], ...patch, channel },
      },
    });
  };

  const audio = plan.audioGuide ?? {
    label: "Edited dialogue mix",
    offsetFrame: 0,
  };

  const downloadEditorialText = (contents: string, extension: string, mimeType: string) => {
    downloadTextFile(contents, editorialFilename(clip.name, extension), mimeType);
  };

  const editorialExportInput = () => ({
    clipId: clip.id,
    clipName: clip.name,
    durationFrames,
    fps: sequence.fps ?? 24,
    performancePlan: plan,
  });

  const exportOtio = () => {
    const otioDocument = exportPerformancePlanToOtio({
      ...editorialExportInput(),
    });
    downloadEditorialText(serializeOtio(otioDocument), "otio", "application/json");
    setEditorialMessage("Exported OTIO with SceneForge direction metadata and visible cue markers.");
  };

  const exportPremiereXml = () => {
    downloadEditorialText(
      exportPerformancePlanToPremiereXml(editorialExportInput()),
      "xml",
      "application/xml",
    );
    setEditorialMessage("Exported Premiere-compatible XML with sequence markers and edited audio timing.");
  };

  const exportEdl = () => {
    downloadEditorialText(exportPerformancePlanToEdl(editorialExportInput()), "edl", "text/plain");
    setEditorialMessage("Exported CMX 3600 EDL with SceneForge cue and audio comments.");
  };

  const importEditorial = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const result = importEditorialTimingFile(file.name, await file.text(), {
        basePlan: plan,
        durationFrames,
        fps: sequence.fps ?? 24,
      });
      if (!result.ok || !result.performancePlan) {
        setEditorialMessage(result.issues.join(" "));
        return;
      }
      commitPlan(result.performancePlan);
      const formatLabel = {
        otio: "OTIO",
        premiere_xml: "Premiere XML",
        cmx3600_edl: "CMX 3600 EDL",
      }[result.format];
      const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
      setEditorialMessage(
        `Imported ${formatLabel}: ${result.performancePlan.cues.length} cue(s), ${result.performancePlan.sources.length} performance source(s).${warningText}`,
      );
    } catch (error) {
      setEditorialMessage(error instanceof Error ? error.message : "Could not read the editorial timing file.");
    }
  };

  return (
    <section className="panel direction-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Direction Contract · {clip.name}</p>
          <h2>Shot ≠ Performance</h2>
        </div>
        <span className={`direction-status ${validation.ok ? hasAuthoredPerformance ? "is-ready" : "is-optional" : "is-blocked"}`}>
          {directionStatusLabel}
        </span>
      </div>

      <div className="direction-policy-banner">
        <strong>Hard separation is on.</strong>
        <span>
          3D previs controls the shot. Acting comes only from the sources and timing authored below.
        </span>
      </div>

      <div className="direction-columns">
        <article className="direction-lane direction-lane-shot">
          <div className="direction-lane-header">
            <div>
              <span className="direction-channel-tag">SHOT / 3D PREVIS</span>
              <h3>Camera & spatial grammar</h3>
            </div>
            <span className="lock-badge">Locked to shot signals</span>
          </div>

          <div className="direction-stats">
            <div><span>World</span><strong>{world?.name ?? "Unassigned"}</strong></div>
            <div><span>Lens</span><strong>{lens.focalLengthMm}mm · {lens.sensorPreset}</strong></div>
            <div><span>Camera keys</span><strong>{cameraParams.keyframes.length}</strong></div>
            <div><span>Stage captures</span><strong>{graph?.keyframeNodeIds.length ?? 0}</strong></div>
            <div><span>Look-at</span><strong>{cameraParams.lookAtTargetElementId ?? "None"}</strong></div>
            <div><span>Playhead</span><strong>{localFrame} / {durationFrames}f</strong></div>
          </div>

          <div className="direction-channel-controls">
            <div className="direction-control-heading">
              <span className="label">Connector controls</span>
              <strong>{LYRA_DIRECTION_CAPABILITIES.label}</strong>
            </div>
            {(["camera", "structure"] as DirectionChannel[]).map((channel) => (
              <DirectionControlEditor
                key={channel}
                control={plan.channelControls[channel]}
                capability={LYRA_DIRECTION_CAPABILITIES.channels[channel]}
                onChange={(patch) => updateChannelControl(channel, patch)}
              />
            ))}
          </div>

          <div className="signal-policy-grid">
            <div>
              <span className="label">AI may preserve</span>
              <p>Framing · camera path/speed · lens · spatial anchors · eyelines · 180° staging · action boundaries</p>
            </div>
            <div className="signal-policy-ignore">
              <span className="label">AI must ignore</span>
              <p>Rough body mechanics · foot/hand contact · facial acting · cloth motion · blocking interpolation</p>
            </div>
          </div>

          <div className="continuity-editor">
            <span className="label">Continuity intent</span>
            <label>
              Line of action
              <input
                value={continuity.lineOfActionLabel}
                placeholder="Actor A → Actor B"
                disabled={!cameraNode}
                onChange={(event) => updateContinuity({ lineOfActionLabel: event.target.value })}
              />
            </label>
            <div className="continuity-actor-grid">
              <label>
                Axis actor A
                <select
                  value={continuity.lineActorAId ?? ""}
                  disabled={!cameraNode || actorAnchors.length < 2}
                  onChange={(event) => updateContinuity({ lineActorAId: event.target.value || undefined })}
                >
                  <option value="">Choose actor</option>
                  {actorAnchors.map((actor) => <option key={actor.id} value={actor.id}>{actor.label ?? actor.id}</option>)}
                </select>
              </label>
              <label>
                Axis actor B
                <select
                  value={continuity.lineActorBId ?? ""}
                  disabled={!cameraNode || actorAnchors.length < 2}
                  onChange={(event) => updateContinuity({ lineActorBId: event.target.value || undefined })}
                >
                  <option value="">Choose actor</option>
                  {actorAnchors.map((actor) => <option key={actor.id} value={actor.id}>{actor.label ?? actor.id}</option>)}
                </select>
              </label>
            </div>
            <label>
              Protected camera side
              <select
                value={continuity.cameraSide}
                disabled={!cameraNode}
                onChange={(event) =>
                  updateContinuity({ cameraSide: event.target.value as typeof continuity.cameraSide })
                }
              >
                <option value="unlocked">Unlocked</option>
                <option value="left">Left side</option>
                <option value="right">Right side</option>
              </select>
            </label>
            <label>
              Screen direction
              <select
                value={continuity.screenDirection}
                disabled={!cameraNode}
                onChange={(event) =>
                  updateContinuity({ screenDirection: event.target.value as typeof continuity.screenDirection })
                }
              >
                <option value="neutral">Neutral</option>
                <option value="left_to_right">Left → right</option>
                <option value="right_to_left">Right → left</option>
              </select>
            </label>
            <div className={`continuity-check is-${continuityValidation.status}`}>
              <strong>180° check · {continuityValidation.status}</strong>
              {continuityValidation.issues.length > 0
                ? continuityValidation.issues.map((issue) => <span key={issue}>{issue}</span>)
                : <span>All camera keys remain on the protected side.</span>}
            </div>
          </div>
        </article>

        <article className="direction-lane direction-lane-performance">
          <div className="direction-lane-header">
            <div>
              <span className="direction-channel-tag">PERFORMANCE / EXTERNAL</span>
              <h3>Acting references & timing</h3>
            </div>
            <span className="lock-badge">No 3D animation input</span>
          </div>

          <div className="direction-channel-controls direction-performance-controls">
            <div className="direction-control-heading">
              <span className="label">Performance preservation</span>
              <strong>
                {capabilityNegotiation.channels.filter((item) => item.status === "accepted").length}/5 requests accepted
              </strong>
            </div>
            {(["performance_body", "performance_face", "audio"] as DirectionChannel[]).map((channel) => (
              <DirectionControlEditor
                key={channel}
                control={plan.channelControls[channel]}
                capability={LYRA_DIRECTION_CAPABILITIES.channels[channel]}
                onChange={(patch) => updateChannelControl(channel, patch)}
              />
            ))}
            {capabilityNegotiation.warnings.length > 0 && (
              <details className="capability-warnings">
                <summary>{capabilityNegotiation.warnings.length} connector downgrade(s)</summary>
                {capabilityNegotiation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </details>
            )}
          </div>

          <div className="direction-section">
            <div className="direction-section-title">
              <div><span className="label">1 · Sources</span><strong>Where the acting comes from</strong></div>
              <div className="button-row">
                <select value={sourceType} onChange={(event) => setSourceType(event.target.value as PerformanceSourceType)}>
                  {PERFORMANCE_SOURCE_TYPES.map((type) => <option key={type} value={type}>{SOURCE_LABELS[type]}</option>)}
                </select>
                <button type="button" onClick={addSource}>Add source</button>
              </div>
            </div>
            {plan.sources.length === 0 && <p className="direction-empty">Add text, live action, mocap, or 2D key animation.</p>}
            <div className="performance-source-list">
              {plan.sources.map((source) => (
                <div key={source.id} className={`performance-source-card ${source.enabled ? "" : "is-disabled"}`}>
                  <div className="performance-card-heading">
                    <span className="source-type-badge">{SOURCE_LABELS[source.type]}</span>
                    <label className="inline-check"><input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} /> Use</label>
                    <button type="button" onClick={() => removeSource(source.id)}>Remove</button>
                  </div>
                  <input value={source.label} aria-label="Source label" onChange={(event) => updateSource(source.id, { label: event.target.value })} />
                  {source.type !== "text_prompt" && (
                    <input value={source.uri ?? ""} aria-label="Reference URI" placeholder="File path or connector URI" onChange={(event) => updateSource(source.id, { uri: event.target.value || undefined })} />
                  )}
                  <PerformanceQualityEditor
                    source={source}
                    onChange={(qualityGate) => updateSource(source.id, { qualityGate })}
                  />
                  <textarea value={source.notes ?? ""} aria-label="Performance notes" placeholder="Performance direction, capture quality, gestures, expression…" onChange={(event) => updateSource(source.id, { notes: event.target.value || undefined })} />
                </div>
              ))}
            </div>
          </div>

          <div className="direction-section">
            <div className="direction-section-title">
              <div><span className="label">2 · Audio guide</span><strong>Edited dialogue & comedy rhythm</strong></div>
              <button
                type="button"
                onClick={() => commitPlan({ ...plan, audioGuide: undefined })}
                disabled={!plan.audioGuide}
              >
                Clear
              </button>
            </div>
            <div className="audio-guide-grid">
              <label>Label<input value={audio.label} onChange={(event) => commitPlan({ ...plan, audioGuide: { ...audio, label: event.target.value } })} /></label>
              <label>Audio URI<input value={audio.uri ?? ""} placeholder="Premiere mixdown or audio asset URI" onChange={(event) => commitPlan({ ...plan, audioGuide: { ...audio, uri: event.target.value || undefined } })} /></label>
              <label>Sync offset (f)<input type="number" value={audio.offsetFrame} onChange={(event) => commitPlan({ ...plan, audioGuide: { ...audio, offsetFrame: Number(event.target.value) } })} /></label>
              <label>Duration (f)<input type="number" min={1} value={audio.durationFrames ?? ""} onChange={(event) => commitPlan({ ...plan, audioGuide: { ...audio, durationFrames: event.target.value ? Number(event.target.value) : undefined } })} /></label>
              <label className="audio-transcript">Transcript / beat notes<textarea value={audio.transcript ?? ""} placeholder="Dialogue, pauses, laugh beats, overlaps…" onChange={(event) => commitPlan({ ...plan, audioGuide: { ...audio, transcript: event.target.value || undefined } })} /></label>
            </div>
            {audio.uri && <audio className="direction-audio-preview" controls preload="metadata" src={audio.uri} />}
          </div>

          <div className="direction-section">
            <div className="direction-section-title">
              <div><span className="label">3 · Timing cues</span><strong>Dialogue, reaction, action, hold</strong></div>
              <div className="button-row">
                <select value={cueKind} onChange={(event) => setCueKind(event.target.value as PerformanceCueKind)}>
                  {PERFORMANCE_CUE_KINDS.map((kind) => <option key={kind} value={kind}>{CUE_LABELS[kind]}</option>)}
                </select>
                <button type="button" onClick={addCue}>Add at {localFrame}f</button>
              </div>
            </div>
            {plan.cues.length === 0 && <p className="direction-empty">Place exact dialogue, reaction, and action windows on the clip.</p>}
            <div className="performance-cue-list">
              {plan.cues.map((cue) => (
                <div key={cue.id} className={`performance-cue-card cue-${cue.kind}`}>
                  <div className="performance-card-heading">
                    <span className="cue-kind-badge">{CUE_LABELS[cue.kind]}</span>
                    <span>{cue.startFrame}–{cue.endFrame}f</span>
                    <button type="button" onClick={() => commitPlan({ ...plan, cues: plan.cues.filter((item) => item.id !== cue.id) })}>Remove</button>
                  </div>
                  <div className="cue-field-grid">
                    <label>Label<input value={cue.label} onChange={(event) => updateCue(cue.id, { label: event.target.value })} /></label>
                    <label>Actor<select value={cue.actorId ?? ""} onChange={(event) => { const actor = actorAnchors.find((item) => item.id === event.target.value); updateCue(cue.id, { actorId: actor?.id, actor: actor?.label }); }}><option value="">Unassigned</option>{actorAnchors.map((actor) => <option key={actor.id} value={actor.id}>{actor.label ?? actor.id}</option>)}</select></label>
                    <label>Target<select value={cue.targetActorId ?? ""} onChange={(event) => updateCue(cue.id, { targetActorId: event.target.value || undefined })}><option value="">None</option>{actorAnchors.map((actor) => <option key={actor.id} value={actor.id}>{actor.label ?? actor.id}</option>)}</select></label>
                    <label>Start<input type="number" min={0} max={durationFrames - 1} value={cue.startFrame} onChange={(event) => updateCue(cue.id, { startFrame: Number(event.target.value) })} /></label>
                    <label>End<input type="number" min={1} max={durationFrames} value={cue.endFrame} onChange={(event) => updateCue(cue.id, { endFrame: Number(event.target.value) })} /></label>
                    <label>Source<select value={cue.sourceId ?? ""} onChange={(event) => updateCue(cue.id, { sourceId: event.target.value || undefined })}><option value="">Unassigned</option>{plan.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
                    <label>Reacts to<select value={cue.reactionToCueId ?? ""} onChange={(event) => updateCue(cue.id, { reactionToCueId: event.target.value || undefined })}><option value="">No dependency</option>{plan.cues.filter((item) => item.id !== cue.id).map((item) => <option key={item.id} value={item.id}>{item.label} · {item.startFrame}f</option>)}</select></label>
                    <label>Overlap<select value={cue.overlapMode ?? "allow"} onChange={(event) => updateCue(cue.id, { overlapMode: event.target.value as PerformanceCue["overlapMode"] })}><option value="allow">Allow</option><option value="avoid">Avoid</option><option value="interrupt">Interrupt</option></select></label>
                    <label className="cue-direction">Direction<textarea value={cue.direction} placeholder="What changes on this exact beat?" onChange={(event) => updateCue(cue.id, { direction: event.target.value })} /></label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="direction-section editorial-exchange">
            <div className="direction-section-title">
              <div><span className="label">4 · Editorial exchange</span><strong>OTIO · Premiere XML · CMX 3600 EDL</strong></div>
              <div className="button-row">
                <button type="button" onClick={() => editorialInputRef.current?.click()}>Import</button>
                <button type="button" onClick={exportOtio}>OTIO</button>
                <button type="button" onClick={exportPremiereXml}>Premiere XML</button>
                <button type="button" onClick={exportEdl}>EDL</button>
              </div>
            </div>
            <input
              ref={editorialInputRef}
              className="visually-hidden-input"
              type="file"
              accept=".otio,.xml,.edl,application/json,application/xml,text/xml,text/plain"
              onChange={(event) => void importEditorial(event)}
            />
            <p className="muted">
              OTIO preserves the full Direction Plan. Premiere XML exchanges sequence markers and edited
              audio; EDL carries edit ranges plus SceneForge timing comments. Generic XML/EDL imports keep
              the current performance sources and channel controls.
            </p>
            {editorialMessage && <p className="editorial-exchange-message">{editorialMessage}</p>}
          </div>

          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <details className="direction-validation" open={validation.errors.length > 0}>
              <summary>Contract checks · {validation.errors.length} errors · {validation.warnings.length} warnings</summary>
              {validation.errors.map((issue) => <p key={`error-${issue}`} className="direction-error">{issue}</p>)}
              {validation.warnings.map((issue) => <p key={`warning-${issue}`} className="muted">{issue}</p>)}
            </details>
          )}
        </article>
      </div>
    </section>
  );
};
