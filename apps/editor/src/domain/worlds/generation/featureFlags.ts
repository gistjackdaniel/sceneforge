// Feature flags for World Generation lane (post single-shot MVP).
// Default OFF. Must not affect or mount into the single-shot flow.
let overrideEnabled: boolean | undefined;

/**
 * Stable flag name to gate World Generation lane adapters.
 * Toggle via build-time env `VITE_FEATURE_WORLD_GEN_LANE` or tests override.
 */
export const WORLD_GEN_LANE_FLAG_NAME = "VITE_FEATURE_WORLD_GEN_LANE";

const readViteFlag = (): string | undefined => {
  const meta = import.meta as { env?: Record<string, unknown> };
  const value = meta.env?.[WORLD_GEN_LANE_FLAG_NAME];
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
};

/**
 * Return whether World Generation lane is enabled.
 * - Defaults to false
 * - Reads Vite env `import.meta.env.VITE_FEATURE_WORLD_GEN_LANE === "1"`
 * - Tests may call `__setWorldGenLaneEnabledForTests` to override
 */
export const isWorldGenLaneEnabled = (): boolean => {
  if (overrideEnabled !== undefined) {
    return overrideEnabled;
  }
  return readViteFlag() === "1";
};

/** Test-only: override the feature flag within a test process. */
export const __setWorldGenLaneEnabledForTests = (value: boolean | undefined): void => {
  overrideEnabled = value;
};

