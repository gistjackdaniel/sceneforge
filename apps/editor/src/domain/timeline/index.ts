export type { ClipSourceType, ClipVariant, Sequence, TimelineClip } from "./types";
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
