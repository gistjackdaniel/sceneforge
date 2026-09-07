import type { NodeBase } from "../graph/types";
import {
  mergeDirectionInvalidations,
  normalizeDirectionChannelControls,
  type DirectionChannelControls,
  type DirectionChannelInvalidation,
  type DirectionFrameRange,
} from "../direction";

export const PERFORMANCE_SOURCE_TYPES = [
  "text_prompt",
  "live_action",
  "motion_capture",
  "key_animation_2d",
] as const;

export type PerformanceSourceType = (typeof PERFORMANCE_SOURCE_TYPES)[number];

export const PERFORMANCE_QUALITY_STATUSES = ["unreviewed", "approved", "rejected"] as const;
export type PerformanceQualityStatus = (typeof PERFORMANCE_QUALITY_STATUSES)[number];

export interface PerformanceQualityGate {
  status: PerformanceQualityStatus;
  /** 0..1, higher is better. */
  trackingConfidence?: number;
  /** 0..1, higher is better. */
  contactConfidence?: number;
  /** 0..1, lower is better. */
  footSlidingScore?: number;
  notes?: string;
}

export const PERFORMANCE_CUE_KINDS = ["dialogue", "reaction", "action", "hold"] as const;

export type PerformanceCueKind = (typeof PERFORMANCE_CUE_KINDS)[number];

export interface PerformanceSource {
  id: string;
  type: PerformanceSourceType;
  label: string;
  /** File path, URL, or connector URI. Text prompts may omit this. */
  uri?: string;
  assetId?: string;
  /** Acting direction, capture notes, or prompt text. */
  notes?: string;
  enabled: boolean;
  qualityGate?: PerformanceQualityGate;
}

export interface PerformanceCue {
  id: string;
  kind: PerformanceCueKind;
  label: string;
  direction: string;
  /** Frames are clip-local and endFrame is exclusive. */
  startFrame: number;
  endFrame: number;
  actor?: string;
  actorId?: string;
  targetActorId?: string;
  sourceId?: string;
  reactionToCueId?: string;
  overlapMode?: "allow" | "avoid" | "interrupt";
}

export interface AudioTimingGuide {
  label: string;
  uri?: string;
  assetId?: string;
  /** Clip-local sync offset. Negative values allow pre-roll. */
  offsetFrame: number;
  durationFrames?: number;
  transcript?: string;
}

export interface PerformancePlanParams extends Record<string, unknown> {
  schemaVersion: 1;
  /** Immutable policy marker consumed by render connectors. */
  separationPolicy: "shot_and_performance";
  sources: PerformanceSource[];
  cues: PerformanceCue[];
  audioGuide?: AudioTimingGuide;
  /** Per-channel preservation intent shared by the shot and performance lanes. */
  channelControls: DirectionChannelControls;
}

export interface PerformancePlanValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export const performancePlanNodeIdForClip = (clipId: string): string =>
  `node-${clipId}-performance`;

export const defaultPerformancePlan = (): PerformancePlanParams => ({
  schemaVersion: 1,
  separationPolicy: "shot_and_performance",
  sources: [],
  cues: [],
  channelControls: normalizeDirectionChannelControls(undefined),
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const asFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const isSourceType = (value: unknown): value is PerformanceSourceType =>
  PERFORMANCE_SOURCE_TYPES.includes(value as PerformanceSourceType);

const isCueKind = (value: unknown): value is PerformanceCueKind =>
  PERFORMANCE_CUE_KINDS.includes(value as PerformanceCueKind);

const clampUnit = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;

const normalizeQualityGate = (value: unknown): PerformanceQualityGate | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const status: PerformanceQualityStatus = PERFORMANCE_QUALITY_STATUSES.includes(
    record.status as PerformanceQualityStatus,
  )
    ? (record.status as PerformanceQualityStatus)
    : "unreviewed";
  return {
    status,
    trackingConfidence: clampUnit(record.trackingConfidence),
    contactConfidence: clampUnit(record.contactConfidence),
    footSlidingScore: clampUnit(record.footSlidingScore),
    notes: asOptionalString(record.notes),
  };
};

const normalizeSource = (value: unknown, index: number): PerformanceSource | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const type = isSourceType(record.type) ? record.type : "text_prompt";
  return {
    id: asOptionalString(record.id) ?? `performance-source-${index + 1}`,
    type,
    label: asOptionalString(record.label) ?? `Performance source ${index + 1}`,
    uri: asOptionalString(record.uri),
    assetId: asOptionalString(record.assetId),
    notes: asOptionalString(record.notes),
    enabled: record.enabled !== false,
    qualityGate: normalizeQualityGate(record.qualityGate),
  };
};

const normalizeCue = (value: unknown, index: number): PerformanceCue | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const startFrame = Math.round(asFiniteNumber(record.startFrame, 0));
  const endFrame = Math.round(asFiniteNumber(record.endFrame, startFrame + 1));
  return {
    id: asOptionalString(record.id) ?? `performance-cue-${index + 1}`,
    kind: isCueKind(record.kind) ? record.kind : "action",
    label: asOptionalString(record.label) ?? `Cue ${index + 1}`,
    direction: asOptionalString(record.direction) ?? "",
    startFrame,
    endFrame,
    actor: asOptionalString(record.actor),
    actorId: asOptionalString(record.actorId),
    targetActorId: asOptionalString(record.targetActorId),
    sourceId: asOptionalString(record.sourceId),
    reactionToCueId: asOptionalString(record.reactionToCueId),
    overlapMode:
      record.overlapMode === "avoid" || record.overlapMode === "interrupt"
        ? record.overlapMode
        : "allow",
  };
};

const normalizeAudioGuide = (value: unknown): AudioTimingGuide | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const uri = asOptionalString(record.uri);
  const assetId = asOptionalString(record.assetId);
  const label = asOptionalString(record.label);
  if (!uri && !assetId && !label) {
    return undefined;
  }
  const duration = asFiniteNumber(record.durationFrames, 0);
  return {
    label: label ?? "Edited audio guide",
    uri,
    assetId,
    offsetFrame: Math.round(asFiniteNumber(record.offsetFrame, 0)),
    durationFrames: duration > 0 ? Math.round(duration) : undefined,
    transcript: asOptionalString(record.transcript),
  };
};

/** Parse persisted or connector-owned params without leaking unknown fields into render input. */
export const performancePlanFromNode = (
  parameters: Record<string, unknown> | undefined,
): PerformancePlanParams => {
  const sourceValues = Array.isArray(parameters?.sources) ? parameters.sources : [];
  const cueValues = Array.isArray(parameters?.cues) ? parameters.cues : [];
  const sources = sourceValues
    .map(normalizeSource)
    .filter((value): value is PerformanceSource => value !== undefined);
  const cues = cueValues
    .map(normalizeCue)
    .filter((value): value is PerformanceCue => value !== undefined)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  return {
    schemaVersion: 1,
    separationPolicy: "shot_and_performance",
    sources,
    cues,
    audioGuide: normalizeAudioGuide(parameters?.audioGuide),
    channelControls: normalizeDirectionChannelControls(parameters?.channelControls),
  };
};

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const cueRangesChangedBetween = (
  previous: PerformanceCue[],
  next: PerformanceCue[],
): DirectionFrameRange[] => {
  const previousById = new Map(previous.map((cue) => [cue.id, cue]));
  const nextById = new Map(next.map((cue) => [cue.id, cue]));
  const ids = new Set([...previousById.keys(), ...nextById.keys()]);
  const ranges: DirectionFrameRange[] = [];
  ids.forEach((id) => {
    const before = previousById.get(id);
    const after = nextById.get(id);
    if (sameValue(before, after)) {
      return;
    }
    if (before) {
      ranges.push({ startFrame: before.startFrame, endFrame: before.endFrame });
    }
    if (after) {
      ranges.push({ startFrame: after.startFrame, endFrame: after.endFrame });
    }
  });
  return ranges;
};

const audioRange = (guide: AudioTimingGuide | undefined): DirectionFrameRange[] | undefined => {
  if (!guide?.durationFrames) {
    return undefined;
  }
  const startFrame = Math.max(0, guide.offsetFrame);
  return [{ startFrame, endFrame: startFrame + guide.durationFrames }];
};

/** Identify the smallest render-direction scope affected by a plan edit. */
export const diffPerformancePlanDirectionInvalidations = (
  previous: PerformancePlanParams,
  next: PerformancePlanParams,
): DirectionChannelInvalidation[] => {
  const changes: DirectionChannelInvalidation[] = [];
  if (!sameValue(previous.sources, next.sources)) {
    changes.push({ channel: "performance_body" }, { channel: "performance_face" });
  }
  if (!sameValue(previous.cues, next.cues)) {
    const frameRanges = cueRangesChangedBetween(previous.cues, next.cues);
    changes.push(
      { channel: "performance_body", frameRanges },
      { channel: "performance_face", frameRanges },
    );
  }
  if (!sameValue(previous.audioGuide, next.audioGuide)) {
    const before = audioRange(previous.audioGuide);
    const after = audioRange(next.audioGuide);
    changes.push({
      channel: "audio",
      frameRanges: before && after ? [...before, ...after] : undefined,
    });
  }
  Object.keys(previous.channelControls).forEach((channel) => {
    const typedChannel = channel as keyof DirectionChannelControls;
    if (!sameValue(previous.channelControls[typedChannel], next.channelControls[typedChannel])) {
      changes.push({ channel: typedChannel });
    }
  });
  return mergeDirectionInvalidations(changes);
};

export const validatePerformancePlan = (
  plan: PerformancePlanParams,
  durationFrames: number,
  availableActorIds?: string[],
): PerformancePlanValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceIds = new Set(plan.sources.map((source) => source.id));
  const cueIds = new Set(plan.cues.map((cue) => cue.id));
  const actorIds = availableActorIds ? new Set(availableActorIds) : undefined;
  const boundedDuration = Math.max(1, durationFrames);

  plan.sources.forEach((source) => {
    if (source.type !== "text_prompt" && !source.uri && !source.assetId) {
      warnings.push(`${source.label}: reference URI or asset is missing.`);
    }
    if (source.type === "text_prompt" && !source.notes?.trim()) {
      warnings.push(`${source.label}: acting direction is empty.`);
    }
    if (source.enabled && source.qualityGate?.status === "rejected") {
      errors.push(`${source.label}: rejected performance source is still enabled.`);
    }
    if (
      source.enabled &&
      (source.type === "live_action" || source.type === "motion_capture") &&
      (!source.qualityGate || source.qualityGate.status === "unreviewed")
    ) {
      warnings.push(`${source.label}: capture quality has not been approved.`);
    }
    if ((source.qualityGate?.trackingConfidence ?? 1) < 0.6) {
      warnings.push(`${source.label}: tracking confidence is below 60%.`);
    }
    if ((source.qualityGate?.contactConfidence ?? 1) < 0.6) {
      warnings.push(`${source.label}: contact confidence is below 60%.`);
    }
    if ((source.qualityGate?.footSlidingScore ?? 0) > 0.35) {
      warnings.push(`${source.label}: foot sliding exceeds the 35% review threshold.`);
    }
  });

  plan.cues.forEach((cue) => {
    if (cue.startFrame < 0) {
      errors.push(`${cue.label}: start frame must be 0 or later.`);
    }
    if (cue.endFrame <= cue.startFrame) {
      errors.push(`${cue.label}: end frame must be after start frame.`);
    }
    if (cue.endFrame > boundedDuration) {
      errors.push(`${cue.label}: cue ends outside the clip (${boundedDuration}f).`);
    }
    if (!cue.direction.trim()) {
      warnings.push(`${cue.label}: performance direction is empty.`);
    }
    if (cue.sourceId && !sourceIds.has(cue.sourceId)) {
      errors.push(`${cue.label}: linked performance source no longer exists.`);
    }
    if (cue.reactionToCueId && !cueIds.has(cue.reactionToCueId)) {
      errors.push(`${cue.label}: linked preceding cue no longer exists.`);
    }
    if (cue.reactionToCueId === cue.id) {
      errors.push(`${cue.label}: a cue cannot react to itself.`);
    }
    if (actorIds && cue.actorId && !actorIds.has(cue.actorId)) {
      errors.push(`${cue.label}: assigned actor is missing from the staging.`);
    }
    if (actorIds && cue.targetActorId && !actorIds.has(cue.targetActorId)) {
      errors.push(`${cue.label}: target actor is missing from the staging.`);
    }
  });

  const dependencies = new Map(plan.cues.map((cue) => [cue.id, cue.reactionToCueId]));
  plan.cues.forEach((cue) => {
    const visited = new Set<string>();
    let cursor: string | undefined = cue.id;
    while (cursor) {
      if (visited.has(cursor)) {
        errors.push(`${cue.label}: cue dependency cycle detected.`);
        break;
      }
      visited.add(cursor);
      cursor = dependencies.get(cursor);
    }
  });

  plan.cues.forEach((cue) => {
    if (!cue.reactionToCueId || cue.overlapMode !== "avoid") {
      return;
    }
    const preceding = plan.cues.find((candidate) => candidate.id === cue.reactionToCueId);
    if (preceding && cue.startFrame < preceding.endFrame) {
      errors.push(`${cue.label}: overlaps ${preceding.label} while overlap mode is Avoid.`);
    }
  });

  if (plan.sources.length === 0) {
    warnings.push("No external performance source has been assigned.");
  }
  if (plan.cues.length === 0) {
    warnings.push("No dialogue, reaction, or action timing cue has been authored.");
  }
  if (!plan.audioGuide?.uri && !plan.audioGuide?.assetId) {
    warnings.push("No pre-edited audio guide has been assigned.");
  }

  return { ok: errors.length === 0, errors, warnings };
};

export const createPerformancePlanNode = (clipId: string, timestamp: string): NodeBase => {
  const parameters = defaultPerformancePlan();
  return {
    id: performancePlanNodeIdForClip(clipId),
    name: "Performance Direction",
    kind: "PerformancePlanNode",
    type: "PerformancePlanNode",
    category: "performance",
    scope: "clip",
    enabled: true,
    tags: ["performance", "external-reference", "no-previs-animation"],
    version: 1,
    referenceType: "local",
    parameters,
    params: parameters,
    downstreamNodeIds: [`node-${clipId}-render`],
    status: "clean",
    inputPorts: [
      { id: "references", name: "performance references", dataType: "performance_ref", required: false, multiple: true },
      { id: "audio", name: "edited audio", dataType: "audio", required: false, multiple: false },
    ],
    outputPorts: [
      { id: "direction", name: "performance direction", dataType: "performance_plan", required: false, multiple: true },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};
