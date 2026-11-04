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
export { createPersistentId, isPersistentId, legacyShotId, legacyShotRevisionId, PERSISTENT_ID_PATTERN } from "./persistentId";
export {
  actorIdForTargetMatches,
  addContactEffectorOverride,
  captureShotEditorial,
  parseContactEffector,
  removeShotOverride,
  resolveShotScene,
  restoreShotEditorial,
  revertShotToRevision,
  updateShotOverride,
  type ShotEditorialSnapshot,
  type ShotEditResult,
} from "./shotEdit";
export {
  adoptShotEditorial,
  shotApprovalSchema,
  shotEditLocalitySchema,
  shotOverrideEventSchema,
  shotRevisionSchema,
  type ShotApproval,
  type ShotEditLocality,
  type ShotEditorialState,
  type ShotOverrideEvent,
  type ShotRevision,
} from "./shotEditorial";
export {
  assetRevisionRefFromRecord,
  assetRevisionRefSchema,
  contactEffectorSchema,
  emptyShotScene,
  shotSceneSchema,
  type AssetRevisionRef,
  type ContactEffector,
  type ShotScene,
} from "./shotScene";
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
