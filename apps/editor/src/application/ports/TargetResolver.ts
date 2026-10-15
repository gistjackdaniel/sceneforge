export interface TargetResolverContext {
  /** Currently selected target IDs (e.g., world element ids) preferred for "it", "that". */
  selectionIds?: string[];
  /** Locale hint to resolve localized names/aliases. */
  locale?: "ko" | "en";
}

export interface ResolvedTarget {
  assetId: string;
  /** character | prop | location — extendable by World lane */
  kind: "character" | "prop" | "location" | "light";
  /** Display name for confirmations */
  displayName: string;
  /** Descending match score (0..1). */
  score: number;
}

/**
 * World lane owns the implementation. Keep this interface stable so they can swap adapters.
 * Returns candidates sorted by descending score; empty means "no match".
 */
export interface TargetResolver {
  resolve(refText: string, context: TargetResolverContext): ResolvedTarget[];
}

