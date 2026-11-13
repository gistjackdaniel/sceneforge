export { getAffectedClipIds, getAffectedClips } from "./affectedClips";
export { computeClipCacheDependencyHash } from "./cacheDependency";
export { buildImpactSentence } from "./impactSentence";
export { collectReferencedNodeIds } from "./referenceGraph";
export { getClipIdsForNode, indexSharedNodeClipUsage } from "./usageIndex";
export { PartialRerenderGate, type PendingRerenderGateState } from "./partialRerenderGate";
export { hashNormalized, hashString, stableSerialize } from "./hash";
export {
  DEPENDENT_RENDER_PASSES,
  persistentInstanceIdSchema,
  normalizeProductionSelector,
  productionSelectorSchema,
  selectorMatches,
  selectorScopeToken,
  selectorToQuery,
  tokenToSelectorQuery,
  type ProductionSelector,
  type SelectorQuery,
} from "./selector";
export {
  assetRevisionSchema,
  buildDependencyFingerprint,
  computePassHash,
  dependencyFingerprintSchema,
  detectOutdatedOutputs,
  diffFingerprint,
  fingerprintKeySchema,
  outputConstraintSchema,
  productionOutputSchema,
  recordComputedOutput,
  type AssetRevision,
  type DependencyFingerprint,
  type FingerprintChange,
  type FingerprintKey,
  type InputIssue,
  type OutdatedDetection,
  type OutdatedOutput,
  type OutputConstraint,
  type OutputProvenanceStore,
  type ProductionOutput,
} from "./fingerprint";
export {
  planRevisionScope,
  revisionEditEventSchema,
  type RevisionEditEvent,
  type OutdatedEditReason,
  type RevisionPlan,
  type ScopeConflict,
  type UnresolvedScope,
} from "./recompute";
export { createLegacyIdResolver, resolveLegacyId, type LegacyIdResolver, type LegacyRefCarrier } from "./legacyAlias";
export {
  interpretScopeEntry,
  scopeLabel,
  contactHandId,
  type EditScopeInput,
  type ShotEntityScope,
} from "./editScope";
export { shotRecordFps, type ShotFpsSource } from "./shotFps";
export { projectShotDependencies, type ShotDependencyGraph, type ShotDependencyNode } from "./shotRecord";
export {
  bindWorldPhase1Selectors,
  resolveWorldAssetId,
  type WorldPhase1Binding,
  type WorldPhase1Result,
} from "./worldPhase1";
