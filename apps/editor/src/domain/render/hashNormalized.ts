/**
 * Temporary copy of Graph lane `hashNormalized`.
 *
 * TODO(#32): Delete this file and import `hashNormalized` from `core/dependency`
 * once `feat/graph-dependency-cache` is on `feat/shot-record`. The signature and
 * the key-sorted serialization below match that module. Do not drift them.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Canonical dependency hash normalization.
 * Object keys are sorted so equivalent payloads share one hash.
 * Array order is preserved. This is the only implementation; World lane
 * Phase 1 validation and node cache keys both call it.
 */
export const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
    .join(",")}}`;
};

export const hashString = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/** Stable serialization followed by the shared string hash. */
export const hashNormalized = (value: unknown): string => hashString(stableSerialize(value));
