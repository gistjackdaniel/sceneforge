export const DIRECTION_CHANNELS = [
  "camera",
  "structure",
  "performance_body",
  "performance_face",
  "audio",
] as const;

export type DirectionChannel = (typeof DIRECTION_CHANNELS)[number];

export const DIRECTION_CHANNEL_LABELS: Record<DirectionChannel, string> = {
  camera: "Camera",
  structure: "Scene structure",
  performance_body: "Body performance",
  performance_face: "Face performance",
  audio: "Edited audio",
};

export interface DirectionMaskReference {
  uri?: string;
  assetId?: string;
}

export interface DirectionChannelControl {
  channel: DirectionChannel;
  /** Preserve the authored source instead of allowing the model to reinterpret it. */
  locked: boolean;
  /** Normalized influence requested from the connector. */
  strength: number;
  mask?: DirectionMaskReference;
}

export type DirectionChannelControls = Record<DirectionChannel, DirectionChannelControl>;

export interface DirectionFrameRange {
  /** Clip-local, inclusive. */
  startFrame: number;
  /** Clip-local, exclusive. */
  endFrame: number;
}

export interface DirectionChannelInvalidation {
  channel: DirectionChannel;
  /** Omitted means the whole channel is invalid. */
  frameRanges?: DirectionFrameRange[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const clampStrength = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, numeric));
};

export const defaultDirectionChannelControls = (): DirectionChannelControls => ({
  camera: { channel: "camera", locked: true, strength: 1 },
  structure: { channel: "structure", locked: true, strength: 1 },
  performance_body: { channel: "performance_body", locked: false, strength: 0.85 },
  performance_face: { channel: "performance_face", locked: false, strength: 0.85 },
  audio: { channel: "audio", locked: true, strength: 1 },
});

export const normalizeDirectionChannelControls = (value: unknown): DirectionChannelControls => {
  const defaults = defaultDirectionChannelControls();
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(
    DIRECTION_CHANNELS.map((channel) => {
      const raw = isRecord(record[channel]) ? record[channel] : {};
      const maskRecord = isRecord(raw.mask) ? raw.mask : undefined;
      const uri = optionalString(maskRecord?.uri);
      const assetId = optionalString(maskRecord?.assetId);
      return [
        channel,
        {
          channel,
          locked: typeof raw.locked === "boolean" ? raw.locked : defaults[channel].locked,
          strength: clampStrength(raw.strength, defaults[channel].strength),
          mask: uri || assetId ? { uri, assetId } : undefined,
        },
      ];
    }),
  ) as DirectionChannelControls;
};

export const directionControlsAsList = (
  controls: DirectionChannelControls,
): DirectionChannelControl[] => DIRECTION_CHANNELS.map((channel) => controls[channel]);

const normalizeRanges = (ranges: DirectionFrameRange[]): DirectionFrameRange[] => {
  const sorted = ranges
    .map((range) => ({
      startFrame: Math.max(0, Math.round(range.startFrame)),
      endFrame: Math.max(0, Math.round(range.endFrame)),
    }))
    .filter((range) => range.endFrame > range.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const merged: DirectionFrameRange[] = [];
  sorted.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.startFrame <= previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, range.endFrame);
    } else {
      merged.push({ ...range });
    }
  });
  return merged;
};

/** Merge invalidation scopes; a full-channel invalidation always wins. */
export const mergeDirectionInvalidations = (
  ...groups: Array<DirectionChannelInvalidation[] | undefined>
): DirectionChannelInvalidation[] => {
  const byChannel = new Map<DirectionChannel, DirectionChannelInvalidation>();
  groups.flatMap((group) => group ?? []).forEach((item) => {
    const existing = byChannel.get(item.channel);
    if (!existing) {
      byChannel.set(item.channel, {
        channel: item.channel,
        frameRanges: item.frameRanges ? normalizeRanges(item.frameRanges) : undefined,
      });
      return;
    }
    if (!existing.frameRanges || !item.frameRanges) {
      byChannel.set(item.channel, { channel: item.channel });
      return;
    }
    byChannel.set(item.channel, {
      channel: item.channel,
      frameRanges: normalizeRanges([...existing.frameRanges, ...item.frameRanges]),
    });
  });
  return DIRECTION_CHANNELS.flatMap((channel) => {
    const item = byChannel.get(channel);
    return item ? [item] : [];
  });
};

export const fullDirectionInvalidation = (): DirectionChannelInvalidation[] =>
  DIRECTION_CHANNELS.map((channel) => ({ channel }));
