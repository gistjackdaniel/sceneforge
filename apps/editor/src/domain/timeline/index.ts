export type { ClipSourceType, ClipVariant, Sequence, TimelineClip } from "./types";
export {
  DEFAULT_SHOT_FPS,
  createShotForClip,
  ensureShotsForClips,
  fpsFromLegacySequence,
  frameToShotSeconds,
  shotForClip,
  shotFps,
  shotFpsForClip,
  shotFrameCount,
  shotSchema,
  shotTimeRange,
  shotTimeRangeSchema,
  withShotFrameLength,
  type Shot,
  type ShotClockSource,
  type ShotTimeRange,
} from "./shot";
export { createPersistentId, isPersistentId, legacyShotId, PERSISTENT_ID_PATTERN } from "./persistentId";
export {
  DEFAULT_CLIP_FPS,
  clipDurationFrames,
  clipEndFrame,
  clipStartFrame,
  migrateClipTiming,
  withClipTiming,
} from "./timing";
export {
  activeVariantPatch,
  createClipVariant,
  ensureClipVariants,
  setActiveVariant,
} from "./variants";
export {
  nodeTemporalRange,
  validateClipTemporalNodes,
  type TemporalValidationResult,
} from "./temporalValidation";
