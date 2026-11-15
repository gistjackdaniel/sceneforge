import { createWorldTargetResolver, type ResolveContext } from "../../domain/worlds/query";
import type { WorldAsset } from "../../domain/worlds/types";
import { hashNormalized } from "./hash";
import { issuesFromZod, type InputIssue } from "./fingerprint";
import { productionSelectorSchema, selectorScopeToken, type ProductionSelector } from "./selector";

export interface WorldPhase1Binding {
  selector: ProductionSelector & { assetId: string };
  /** Always `WorldAsset.id`. */
  assetId: string;
  scopeToken: string;
}

export type WorldPhase1Result =
  | { ok: true; bindings: WorldPhase1Binding[]; passHash: string }
  | { ok: false; error: "invalid_input" | "unresolved_asset"; issues: InputIssue[] };

const defaultContext = (): ResolveContext => ({ selectionIds: [], locale: "en" });

/**
 * Resolve a reference to `WorldAsset.id`.
 * Exact ids are accepted from the world record. Names, aliases, and tags go
 * through `createWorldTargetResolver` only.
 */
export const resolveWorldAssetId = (
  worlds: Record<string, WorldAsset>,
  refText: string,
  ctx: ResolveContext,
): { ok: true; assetId: string } | { ok: false; message: string } => {
  const ref = refText.trim();
  if (!ref) {
    return { ok: false, message: "WorldAsset 참조가 비어 있습니다." };
  }
  if (worlds[ref]) {
    return { ok: true, assetId: worlds[ref].id };
  }

  const matches = createWorldTargetResolver(worlds).resolve(ref, ctx);
  if (matches.length === 0) {
    return { ok: false, message: `"${ref}"는 WorldAsset.id로 조회되지 않습니다.` };
  }
  const topScore = matches[0]?.score ?? 0;
  const assetIds = Array.from(
    new Set(matches.filter((match) => match.score === topScore).map((match) => match.assetId)),
  );
  if (assetIds.length !== 1 || !assetIds[0] || !worlds[assetIds[0]]) {
    return { ok: false, message: `"${ref}"가 여러 WorldAsset에 맞습니다.` };
  }
  return { ok: true, assetId: assetIds[0] };
};

/**
 * World lane Phase 1 validation. Selectors and the pass hash both come from
 * `core/dependency`. Bound `assetId` values are `WorldAsset.id`.
 * Does not write world or cache state.
 */
export const bindWorldPhase1Selectors = (input: {
  worlds: Record<string, WorldAsset>;
  selectors: unknown[];
  assetRef?: string;
  ctx?: ResolveContext;
}): WorldPhase1Result => {
  const ctx = input.ctx ?? defaultContext();
  const issues: InputIssue[] = [];
  const bindings: WorldPhase1Binding[] = [];

  input.selectors.forEach((candidate, index) => {
    const parsed = productionSelectorSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(
        ...issuesFromZod(parsed.error).map((issue) => ({
          path: `selectors.${index}${issue.path ? `.${issue.path}` : ""}`,
          message: issue.message,
        })),
      );
      return;
    }
    const explicitAssetId = parsed.data.assetId;
    const resolved = explicitAssetId
      ? input.worlds[explicitAssetId]
        ? { ok: true as const, assetId: input.worlds[explicitAssetId].id }
        : {
            ok: false as const,
            message: `"${explicitAssetId}"는 WorldAsset.id가 아닙니다.`,
          }
      : resolveWorldAssetId(input.worlds, input.assetRef ?? "", ctx);
    if (!resolved.ok) {
      issues.push({ path: `selectors.${index}.assetId`, message: resolved.message });
      return;
    }
    const selector = { ...parsed.data, assetId: resolved.assetId };
    bindings.push({
      selector,
      assetId: resolved.assetId,
      scopeToken: selectorScopeToken(selector),
    });
  });

  if (issues.length > 0) {
    const unresolvedAsset = issues.every((issue) => issue.path.endsWith("assetId"));
    return { ok: false, error: unresolvedAsset ? "unresolved_asset" : "invalid_input", issues };
  }

  const digest = bindings
    .map((binding) => ({ assetId: binding.assetId, scopeToken: binding.scopeToken, selector: binding.selector }))
    .sort((left, right) => left.scopeToken.localeCompare(right.scopeToken));

  return { ok: true, bindings, passHash: hashNormalized(digest) };
};
