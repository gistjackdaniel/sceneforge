import {
  performancePlanFromNode,
  type PerformanceCue,
  type PerformancePlanParams,
} from "../performance";

type JsonRecord = Record<string, unknown>;

export interface OtioExportInput {
  clipId: string;
  clipName: string;
  durationFrames: number;
  fps: number;
  performancePlan: PerformancePlanParams;
}

export interface OtioImportResult {
  ok: boolean;
  performancePlan?: PerformancePlanParams;
  clipId?: string;
  fps?: number;
  issues: string[];
}

const rationalTime = (value: number, rate: number): JsonRecord => ({
  OTIO_SCHEMA: "RationalTime.1",
  value,
  rate,
});

const timeRange = (startFrame: number, durationFrames: number, fps: number): JsonRecord => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: rationalTime(startFrame, fps),
  duration: rationalTime(durationFrames, fps),
});

const markerColor = (cue: PerformanceCue): JsonRecord => {
  const colorByKind = {
    dialogue: [0.21, 0.64, 1],
    reaction: [0.72, 0.54, 1],
    action: [1, 0.7, 0.28],
    hold: [0.45, 0.95, 0.72],
  } as const;
  const [r, g, b] = colorByKind[cue.kind];
  return { OTIO_SCHEMA: "Color.1", name: cue.kind, r, g, b, a: 1 };
};

const cueMarker = (cue: PerformanceCue, fps: number): JsonRecord => ({
  OTIO_SCHEMA: "Marker.3",
  name: cue.label,
  comment: cue.direction,
  marked_range: timeRange(cue.startFrame, cue.endFrame - cue.startFrame, fps),
  color: markerColor(cue),
  metadata: {
    sceneforge: {
      schemaVersion: 1,
      cue,
    },
  },
});

const missingReference = (): JsonRecord => ({
  OTIO_SCHEMA: "MissingReference.1",
  name: "",
  metadata: {},
  available_range: null,
  available_image_bounds: null,
});

const externalReference = (
  uri: string,
  durationFrames: number,
  fps: number,
): JsonRecord => ({
  OTIO_SCHEMA: "ExternalReference.1",
  name: "Edited audio guide",
  target_url: uri,
  metadata: {},
  available_range: timeRange(0, durationFrames, fps),
  available_image_bounds: null,
});

const otioClip = (input: {
  name: string;
  durationFrames: number;
  fps: number;
  markers?: JsonRecord[];
  metadata?: JsonRecord;
  mediaReference?: JsonRecord;
}): JsonRecord => ({
  OTIO_SCHEMA: "Clip.2",
  name: input.name,
  metadata: input.metadata ?? {},
  source_range: timeRange(0, input.durationFrames, input.fps),
  effects: [],
  markers: input.markers ?? [],
  enabled: true,
  active_media_reference_key: "DEFAULT_MEDIA",
  media_references: {
    DEFAULT_MEDIA: input.mediaReference ?? missingReference(),
  },
});

const track = (name: string, kind: "Video" | "Audio", children: JsonRecord[]): JsonRecord => ({
  OTIO_SCHEMA: "Track.1",
  name,
  kind,
  children,
  metadata: {},
  source_range: null,
  effects: [],
  markers: [],
  enabled: true,
});

/**
 * Export a native OTIO JSON tree with SceneForge-specific data namespaced in metadata.
 * Markers remain visible to ordinary editorial tools; the metadata enables lossless round-trip.
 */
export const exportPerformancePlanToOtio = (input: OtioExportInput): JsonRecord => {
  const fps = Math.max(1, input.fps);
  const durationFrames = Math.max(1, Math.round(input.durationFrames));
  const namespace = {
    schemaVersion: 1,
    clipId: input.clipId,
    fps,
    performancePlan: input.performancePlan,
  };
  const tracks: JsonRecord[] = [
    track("V1 · SceneForge Direction", "Video", [
      otioClip({
        name: input.clipName,
        durationFrames,
        fps,
        markers: input.performancePlan.cues.map((cue) => cueMarker(cue, fps)),
        metadata: { sceneforge: namespace },
      }),
    ]),
  ];

  const audio = input.performancePlan.audioGuide;
  if (audio?.uri || audio?.assetId) {
    const audioDuration = audio.durationFrames ?? durationFrames;
    tracks.push(
      track("A1 · Edited Audio Guide", "Audio", [
        otioClip({
          name: audio.label,
          durationFrames: audioDuration,
          fps,
          metadata: {
            sceneforge: {
              clipId: input.clipId,
              audioGuide: audio,
              offsetFrame: audio.offsetFrame,
            },
          },
          mediaReference: externalReference(audio.uri ?? `asset://${audio.assetId}`, audioDuration, fps),
        }),
      ]),
    );
  }

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: `${input.clipName} · SceneForge Direction`,
    metadata: { sceneforge: namespace },
    global_start_time: rationalTime(0, fps),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: tracks,
      metadata: {},
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
    },
  };
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const findSceneForgeNamespace = (value: unknown): JsonRecord | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findSceneForgeNamespace(item);
      if (match?.performancePlan) {
        return match;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const namespace = metadata && isRecord(metadata.sceneforge) ? metadata.sceneforge : undefined;
  if (namespace?.performancePlan) {
    return namespace;
  }
  for (const nested of Object.values(value)) {
    const match = findSceneForgeNamespace(nested);
    if (match?.performancePlan) {
      return match;
    }
  }
  return undefined;
};

/** Import only the lossless SceneForge namespace; generic OTIO remains untouched. */
export const importPerformancePlanFromOtio = (value: unknown): OtioImportResult => {
  if (!isRecord(value) || value.OTIO_SCHEMA !== "Timeline.1") {
    return { ok: false, issues: ["The selected file is not an OTIO Timeline.1 document."] };
  }
  const namespace = findSceneForgeNamespace(value);
  if (!namespace || !isRecord(namespace.performancePlan)) {
    return {
      ok: false,
      issues: ["No lossless SceneForge direction metadata was found in this OTIO file."],
    };
  }
  return {
    ok: true,
    performancePlan: performancePlanFromNode(namespace.performancePlan),
    clipId: typeof namespace.clipId === "string" ? namespace.clipId : undefined,
    fps: typeof namespace.fps === "number" ? namespace.fps : undefined,
    issues: [],
  };
};

export const serializeOtio = (document: JsonRecord): string => JSON.stringify(document, null, 2);

