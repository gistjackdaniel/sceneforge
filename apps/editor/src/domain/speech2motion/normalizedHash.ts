/**
 * Temporary copy of the Graph lane hash.
 *
 * TODO(graph #32, `feat/graph-dependency-cache`): delete this file and import
 * `stableSerialize`, `hashString`, and `hashNormalized` from `core/dependency/hash.ts`.
 * The signatures match that module so the swap is a re-export.
 * Camera preserve slices are keyed by `CameraTake.id`, not by a fixed take prefix.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Canonical dependency hash normalization. Object keys are sorted. Array order is kept. */
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
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`).join(",")}}`;
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
