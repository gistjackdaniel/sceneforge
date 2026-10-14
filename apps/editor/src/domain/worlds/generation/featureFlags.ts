// Feature flags for World Generation lane (post single-shot MVP).
// Default OFF. Must not affect or mount into the single-shot flow.
let overrideEnabled: boolean | undefined;

/**
 * Stable flag name to gate World Generation lane adapters.
 * Toggle via build-time env `VITE_FEATURE_WORLD_GEN_LANE` or tests override.
 */
export const WORLD_GEN_LANE_FLAG_NAME = "VITE_FEATURE_WORLD_GEN_LANE";

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
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env as Record<string, unknown> | undefined;
    if (env && String(env[WORLD_GEN_LANE_FLAG_NAME]) === "1") {
      return true;
    }
  } catch {
    // ignore — Node/vitest may not define import.meta.env
  }
  return false;
};

/** Test-only: override the feature flag within a test process. */
export const __setWorldGenLaneEnabledForTests = (value: boolean | undefined): void => {
  overrideEnabled = value;
};

