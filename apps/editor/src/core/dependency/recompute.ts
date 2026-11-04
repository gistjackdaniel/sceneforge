import { z } from "zod";
import { collectDownstream } from "../../domain/graph/dirty";
import {
  issuesFromZod,
  productionOutputSchema,
  type InputIssue,
  type ProductionOutput,
} from "./fingerprint";
import {
  DEPENDENT_RENDER_PASSES,
  productionSelectorSchema,
  selectorMatches,
  selectorScopeToken,
  selectorToQuery,
  tokenToSelectorQuery,
  type SelectorQuery,
} from "./selector";

const scopeEntrySchema = z.union([z.string().min(1), productionSelectorSchema]);
type ScopeEntry = z.infer<typeof scopeEntrySchema>;

export const revisionEditEventSchema = z
  .object({
    shot_id: z.string().min(1).optional(),
    shotId: z.string().min(1).optional(),
    operation: z.string().min(1),
    actor_id: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    target_actor_id: z.string().min(1).optional(),
    targetActorId: z.string().min(1).optional(),
    contact_event_id: z.string().min(1).optional(),
    contactEventId: z.string().min(1).optional(),
    new_effector: z.string().min(1).optional(),
    newEffector: z.string().min(1).optional(),
    instance_id: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    preserve: z.array(scopeEntrySchema),
    recompute: z.array(scopeEntrySchema),
  })
  .transform((value) => ({
    shotId: value.shotId ?? value.shot_id ?? "",
    operation: value.operation,
    actorId: value.actorId ?? value.actor_id,
    targetActorId: value.targetActorId ?? value.target_actor_id,
    contactEventId: value.contactEventId ?? value.contact_event_id,
    newEffector: value.newEffector ?? value.new_effector,
    instanceId: value.instanceId ?? value.instance_id,
    preserve: value.preserve,
    recompute: value.recompute,
  }))
  .refine((value) => value.shotId.length > 0, { message: "shotId가 필요합니다." });

export type RevisionEditEvent = z.infer<typeof revisionEditEventSchema>;

export interface ScopeConflict {
  token?: string;
  outputId?: string;
  nodeId?: string;
  preserve: string[];
  recompute: string[];
}

export interface UnresolvedScope {
  list: "preserve" | "recompute";
  entry: string;
  message: string;
}

export type RevisionPlan =
  | {
      ok: true;
      shotId: string;
      operation: string;
      invalidateOutputIds: string[];
      invalidateNodeIds: string[];
      invalidateCacheIds: string[];
      preservedOutputIds: string[];
      hardLockedOutputIds: string[];
    }
  | { ok: false; error: "invalid_input"; issues: InputIssue[] }
  | {
      ok: false;
      error: "preserve_recompute_conflict";
      message: string;
      conflicts: ScopeConflict[];
    }
  | { ok: false; error: "unresolved_scope"; message: string; unresolved: UnresolvedScope[] };

interface ScopeHit {
  outputId: string;
  nodeId: string;
  label: string;
}

const entryLabel = (entry: ScopeEntry): string =>
  typeof entry === "string" ? entry : selectorScopeToken(entry);

const queryForEntry = (
  entry: ScopeEntry,
): SelectorQuery | typeof DEPENDENT_RENDER_PASSES | undefined => {
  if (typeof entry === "string") {
    return tokenToSelectorQuery(entry);
  }
  return selectorToQuery(entry);
};

const outputInstanceId = (output: ProductionOutput): string | undefined =>
  output.selector.instanceId ?? output.fingerprint.assetRevision.instanceId;

const matchEntry = (
  entry: ScopeEntry,
  outputs: ProductionOutput[],
  list: "preserve" | "recompute",
  scopeInstanceId?: string,
): { hits: ScopeHit[] } | { unresolved: UnresolvedScope } | { deferred: true } => {
  const label = entryLabel(entry);
  const query = queryForEntry(entry);
  if (query === undefined) {
    return {
      unresolved: {
        list,
        entry: label,
        message: `알 수 없는 범위입니다: ${label}`,
      },
    };
  }
  if (query === DEPENDENT_RENDER_PASSES) {
    return { deferred: true };
  }
  const hits = outputs
    .filter((output) => {
      if (!selectorMatches(output.selector, query)) {
        return false;
      }
      if (!scopeInstanceId) {
        return true;
      }
      const instanceId = outputInstanceId(output);
      return instanceId === undefined || instanceId === scopeInstanceId;
    })
    .map((output) => ({ outputId: output.outputId, nodeId: output.nodeId, label }));
  if (hits.length === 0) {
    return {
      unresolved: {
        list,
        entry: label,
        message: `범위에 해당하는 출력이 없습니다: ${label}`,
      },
    };
  }
  return { hits };
};

const unique = (values: string[]): string[] => Array.from(new Set(values));

/**
 * Resolve a revision edit into the outputs that must be recomputed.
 *
 * Invalidation is the `recompute` set plus graph downstream. Outputs named by
 * `preserve`, and Hard-locked outputs, stay cached. A target that appears in
 * both lists is a conflict: the plan fails and nothing is invalidated.
 * When the event carries `instanceId`, direct matches and downstream outputs
 * that belong to a different persistent instance stay cached.
 * This function does not write caches.
 */
export const planRevisionScope = (
  eventInput: unknown,
  snapshot: { outputs: unknown[]; downstreamByNodeId: Record<string, string[]> },
): RevisionPlan => {
  const eventParsed = revisionEditEventSchema.safeParse(eventInput);
  if (!eventParsed.success) {
    return { ok: false, error: "invalid_input", issues: issuesFromZod(eventParsed.error) };
  }
  const outputsParsed = z.array(productionOutputSchema).safeParse(snapshot.outputs);
  if (!outputsParsed.success) {
    return { ok: false, error: "invalid_input", issues: issuesFromZod(outputsParsed.error) };
  }

  const event = eventParsed.data;
  const outputs = outputsParsed.data;

  const preserveHits = new Map<string, ScopeHit>();
  const recomputeHits = new Map<string, ScopeHit>();
  const preserveLabels = new Map<string, string[]>();
  const recomputeLabels = new Map<string, string[]>();
  const unresolved: UnresolvedScope[] = [];
  let recomputeDependentPasses = false;
  let preserveDependentPasses = false;

  const absorb = (
    list: "preserve" | "recompute",
    entry: ScopeEntry,
    hits: Map<string, ScopeHit>,
    labels: Map<string, string[]>,
  ) => {
    const matched = matchEntry(
      entry,
      outputs,
      list,
      list === "recompute" ? event.instanceId : undefined,
    );
    if ("deferred" in matched) {
      if (list === "recompute") {
        recomputeDependentPasses = true;
      } else {
        preserveDependentPasses = true;
      }
      return;
    }
    if ("unresolved" in matched) {
      unresolved.push(matched.unresolved);
      return;
    }
    matched.hits.forEach((hit) => {
      hits.set(hit.outputId, hit);
      const existing = labels.get(hit.outputId) ?? [];
      if (!existing.includes(hit.label)) {
        existing.push(hit.label);
      }
      labels.set(hit.outputId, existing);
    });
  };

  event.preserve.forEach((entry) => absorb("preserve", entry, preserveHits, preserveLabels));
  event.recompute.forEach((entry) => absorb("recompute", entry, recomputeHits, recomputeLabels));

  const sharedTokens = event.preserve
    .filter((entry): entry is string => typeof entry === "string")
    .filter((token) => event.recompute.some((entry) => entry === token));

  const conflicts: ScopeConflict[] = [];
  outputs.forEach((output) => {
    if (!preserveHits.has(output.outputId) || !recomputeHits.has(output.outputId)) {
      return;
    }
    conflicts.push({
      outputId: output.outputId,
      nodeId: output.nodeId,
      preserve: preserveLabels.get(output.outputId) ?? [],
      recompute: recomputeLabels.get(output.outputId) ?? [],
    });
  });
  sharedTokens.forEach((token) => {
    const alreadyNamed = conflicts.some(
      (conflict) => conflict.preserve.includes(token) && conflict.recompute.includes(token),
    );
    if (!alreadyNamed) {
      conflicts.push({ token, preserve: [token], recompute: [token] });
    }
  });

  if (conflicts.length > 0) {
    const names = conflicts.map((conflict) => conflict.outputId ?? conflict.token ?? "unknown");
    return {
      ok: false,
      error: "preserve_recompute_conflict",
      message: `preserve와 recompute가 충돌합니다: ${names.join(", ")}`,
      conflicts,
    };
  }

  if (recomputeDependentPasses && recomputeHits.size === 0) {
    unresolved.push({
      list: "recompute",
      entry: DEPENDENT_RENDER_PASSES,
      message: "dependent_render_passes는 다른 recompute 대상의 하류가 있어야 합니다.",
    });
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      error: "unresolved_scope",
      message: unresolved.map((item) => item.message).join(" "),
      unresolved,
    };
  }

  const closure = new Set<string>();
  recomputeHits.forEach((hit) => {
    collectDownstream(hit.nodeId, snapshot.downstreamByNodeId).forEach((nodeId) => closure.add(nodeId));
  });

  const invalidate = new Map<string, ProductionOutput>();
  const hardLockedOutputIds: string[] = [];
  const preservedDependentIds: string[] = [];

  outputs.forEach((output) => {
    const direct = recomputeHits.has(output.outputId);
    const downstream = closure.has(output.nodeId);
    if (!direct && !downstream) {
      return;
    }
    const instanceId = outputInstanceId(output);
    if (event.instanceId && instanceId && instanceId !== event.instanceId) {
      return;
    }
    if (output.constraint === "hard_locked") {
      hardLockedOutputIds.push(output.outputId);
      return;
    }
    const preservedPass =
      preserveDependentPasses && output.selector.kind === "render_pass" && downstream && !direct;
    if (preserveHits.has(output.outputId) || preservedPass) {
      if (preservedPass) {
        preservedDependentIds.push(output.outputId);
      }
      return;
    }
    invalidate.set(output.outputId, output);
  });

  return {
    ok: true,
    shotId: event.shotId,
    operation: event.operation,
    invalidateOutputIds: Array.from(invalidate.keys()),
    invalidateNodeIds: unique(Array.from(invalidate.values()).map((output) => output.nodeId)),
    invalidateCacheIds: unique(Array.from(invalidate.values()).map((output) => output.cacheId)),
    preservedOutputIds: unique([...preserveHits.keys(), ...preservedDependentIds]),
    hardLockedOutputIds,
  };
};
