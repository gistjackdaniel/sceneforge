import { createWorldTargetResolver, type ResolveContext, type TargetResolver } from "../query";
import type { WorldAsset } from "../types";

/**
 * World set used to resolve a generation target.
 * Name, alias, and tag lookup goes through `TargetResolver`.
 * An exact `WorldAsset.id` is accepted only when that id is already in `worlds`.
 */
export interface WorldTargetScope {
  worlds: Record<string, WorldAsset>;
  /** Official resolver. Defaults to `createWorldTargetResolver(worlds)`. */
  resolver?: TargetResolver;
  resolveContext?: ResolveContext;
}

const resolveContextOrDefault = (ctx?: ResolveContext): ResolveContext => ({
  selectionIds: ctx?.selectionIds ?? [],
  locale: ctx?.locale ?? "ko",
});

const worldByExactId = (worlds: Record<string, WorldAsset>, id: string): WorldAsset | undefined =>
  Object.values(worlds).find((world) => world?.id === id);

/**
 * Resolve one scene target to a `WorldAsset.id`.
 *
 * Invalidation: none. This does not read project state beyond the passed world set.
 * Downstream: adapters copy the returned id into `WorldGenerationRequest` and nowhere else.
 * Side effects: none. Throws when the reference is empty, ambiguous, or not a known world id.
 *
 * Exact ids are matched against `worlds` before `TargetResolver`. The resolver indexes
 * names, aliases, and tags, not ids, so feeding an id through similarity search can
 * collide with other worlds that share those tokens.
 */
export const resolveWorldAssetId = (refText: string, scope: WorldTargetScope): string => {
  const ref = String(refText ?? "").trim();
  if (!ref) {
    throw new Error("World target reference is empty.");
  }

  const direct = worldByExactId(scope.worlds, ref);
  if (direct) {
    return direct.id;
  }

  const resolver = scope.resolver ?? createWorldTargetResolver(scope.worlds);
  const matches = resolver.resolve(ref, resolveContextOrDefault(scope.resolveContext));
  if (matches.length === 0) {
    throw new Error(`World target could not be resolved: ${ref}`);
  }

  const topScore = Math.max(...matches.map((match) => match.score));
  const topIds = [...new Set(matches.filter((match) => match.score === topScore).map((match) => match.assetId))];
  if (topIds.length !== 1) {
    throw new Error(`World target is ambiguous: ${ref}`);
  }

  const resolved = worldByExactId(scope.worlds, topIds[0] ?? "");
  if (!resolved) {
    throw new Error("Resolved target is not a WorldAsset.id.");
  }
  return resolved.id;
};
