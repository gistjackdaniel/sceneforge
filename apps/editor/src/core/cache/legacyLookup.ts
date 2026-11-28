import type { LegacyIdResolver } from "../dependency/legacyAlias";

export interface RekeyResult<T> {
  hit: boolean;
  via: "current" | "legacy" | "miss";
  cache: Record<string, T>;
  entry?: T;
}

/**
 * Look up `currentKey`. On a miss, replace a current id in the key with a legacy
 * id and reuse that entry. The entry is re-keyed to `currentKey`.
 * Status, dependency hash, and invalidated-by lists are not changed: a rename is not an edit.
 */
export const rekeyCacheEntry = <T extends { id?: string }>(
  cache: Record<string, T>,
  currentKey: string,
  resolver: Pick<LegacyIdResolver, "legacyIds">,
): RekeyResult<T> => {
  const current = cache[currentKey];
  if (current) {
    return { hit: true, via: "current", cache, entry: current };
  }
  const segments = currentKey.split(":");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    for (const legacyId of resolver.legacyIds(segment)) {
      const replaced = segments.slice();
      replaced[index] = legacyId;
      const legacyKey = replaced.join(":");
      const found = cache[legacyKey];
      if (!found || legacyKey === currentKey) {
        continue;
      }
      const entry = found.id === legacyKey ? { ...found, id: currentKey } : found;
      const next: Record<string, T> = { ...cache, [currentKey]: entry };
      delete next[legacyKey];
      return { hit: true, via: "legacy", cache: next, entry };
    }
  }
  return { hit: false, via: "miss", cache };
};
