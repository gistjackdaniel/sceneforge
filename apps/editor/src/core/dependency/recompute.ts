import { z } from "zod";
import { collectDownstream } from "../../domain/graph/dirty";
import { contactHandId, interpretScopeEntry, scopeLabel, type EditScopeInput, type EditSourceInput } from "./editScope";
import {
  issuesFromZod,
  productionOutputSchema,
  type InputIssue,
  type ProductionOutput,
} from "./fingerprint";
import {
  DEPENDENT_RENDER_PASSES,
  normalizeProductionSelector,
  selectorMatches,
  type ProductionSelector,
  type SelectorQuery,
} from "./selector";

/**
 * Envelope for an edit's preserve/recompute lists.
 * List items stay `unknown`: the producer schema is `actionGraph.ts`, which is
 * not on this branch, so this object does not redefine that schema.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

const readSource = (value: unknown): EditSourceInput | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type !== "voice" && value.type !== "text" && value.type !== "manual") {
    return undefined;
  }
  const transcript = typeof value.transcript === "string" ? value.transcript : undefined;
  return { type: value.type, ...(transcript !== undefined ? { transcript } : {}) };
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

export const revisionEditEventSchema = z
  .object({
    shot_id: z.string().min(1).optional(),
    shotId: z.string().min(1).optional(),
    operation: z.string().min(1),
    instance_id: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    instance_ids: z.array(z.string().min(1)).optional(),
    instanceIds: z.array(z.string().min(1)).optional(),
    edit_id: z.string().min(1).optional(),
    base_graph_version: z.string().min(1).optional(),
    source: z.unknown().optional(),
    preserve: z.array(z.unknown()),
    recompute: z.array(z.unknown()),
  })
  .transform((value) => {
    const listed = stringList(value.instanceIds ?? value.instance_ids);
    const single = value.instanceId ?? value.instance_id;
    const instanceIds = listed.length > 0 ? listed : single ? [single] : [];
    const source = readSource(value.source);
    return {
      shotId: value.shotId ?? value.shot_id ?? "",
      operation: value.operation,
      instanceIds,
      ...(value.edit_id ? { edit_id: value.edit_id } : {}),
      ...(value.base_graph_version ? { base_graph_version: value.base_graph_version } : {}),
      ...(source ? { source } : {}),
      preserve: value.preserve,
      recompute: value.recompute,
    };
  })
  .refine((value) => value.shotId.length > 0, { message: "shotId가 필요합니다." });

export type RevisionEditEvent = EditScopeInput;

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

export interface OutdatedEditReason {
  outputId: string;
  edit_id?: string;
  source?: EditSourceInput;
  reason: string;
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
      edit_id?: string;
      source?: EditSourceInput;
      reasons: OutdatedEditReason[];
    }
  | { ok: false; error: "invalid_input"; issues: InputIssue[] }
  | {
      ok: false;
      error: "preserve_recompute_conflict";
      message: string;
      conflicts: ScopeConflict[];
    }
  | { ok: false; error: "unresolved_scope"; message: string; unresolved: UnresolvedScope[] }
  | {
      ok: false;
      error: "stale_base_graph_version";
      message: string;
      base_graph_version: string;
      graphVersion: string;
    }
  | {
      ok: false;
      error: "contact_instance_conflict";
      message: string;
      contactIds: string[];
      instanceIds: string[];
      contactGraphInstanceIds: string[];
    };

interface ScopeHit {
  outputId: string;
  nodeId: string;
  label: string;
}

const entryLabel = (entry: unknown): string => scopeLabel(entry);

const queryForEntry = (entry: unknown): SelectorQuery | typeof DEPENDENT_RENDER_PASSES | undefined => {
  const interpreted = interpretScopeEntry(entry);
  if ("unresolved" in interpreted) {
    return undefined;
  }
  if ("dependent" in interpreted) {
    return DEPENDENT_RENDER_PASSES;
  }
  return interpreted.query;
};

const outputInstanceId = (output: ProductionOutput): string | undefined =>
  output.selector.instanceId ?? output.fingerprint.assetRevision.instanceId;

const matchesInstance = (output: ProductionOutput, instanceIds: readonly string[]): boolean => {
  if (instanceIds.length === 0) {
    return true;
  }
  const instanceId = outputInstanceId(output);
  return instanceId === undefined || instanceIds.includes(instanceId);
};

/** Structural `contact_graph[]` entry. Field names follow `actionGraph.ts`. Not a second schema. */
interface ContactEndpointRef {
  actor_id?: string;
  object_id?: string;
  part?: string;
}

interface ContactGraphRef {
  contact_id: string;
  a: ContactEndpointRef;
  b: ContactEndpointRef;
}

const readEndpoint = (value: unknown): ContactEndpointRef | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(text(value.actor_id) ? { actor_id: text(value.actor_id) } : {}),
    ...(text(value.object_id) ? { object_id: text(value.object_id) } : {}),
    ...(text(value.part) ? { part: text(value.part) } : {}),
  };
};

const readContactGraph = (value: unknown): { ok: true; entries: ContactGraphRef[] } | { ok: false } => {
  if (!Array.isArray(value)) {
    return { ok: false };
  }
  const entries: ContactGraphRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false };
    }
    const contact_id = text(item.contact_id);
    const a = readEndpoint(item.a);
    const b = readEndpoint(item.b);
    if (!contact_id || !a || !b) {
      return { ok: false };
    }
    entries.push({ contact_id, a, b });
  }
  return { ok: true, entries };
};

const endpointInstanceIds = (endpoint: ContactEndpointRef): string[] =>
  [endpoint.actor_id, endpoint.object_id].filter((id): id is string => id !== undefined);

const contactGraphInstanceIds = (entry: ContactGraphRef): string[] =>
  unique([...endpointInstanceIds(entry.a), ...endpointInstanceIds(entry.b)]);

const contactIdOf = (entry: unknown): string | undefined => {
  const normalized = normalizeProductionSelector(entry);
  if (!normalized || normalized === "dependent" || normalized.kind !== "contact") {
    return undefined;
  }
  return normalized.contactId;
};

const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = unique([...left]).sort();
  const b = unique([...right]).sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
};

/**
 * `{ kind: "motion", actor_id }` also selects that actor's contact-hand pose.
 * Rig parts and other contacts stay out of this match.
 */
const matchesActorMotion = (selector: ProductionSelector, query: SelectorQuery): boolean => {
  if (query.kind !== "actor" || query.motion !== "motion") {
    return false;
  }
  if (selector.kind !== "contact" || selector.part || selector.actorId !== query.actorId) {
    return false;
  }
  return selector.contactId === undefined || selector.contactId === contactHandId(query.actorId);
};

const isEndpointPart = (selector: ProductionSelector, entry: ContactGraphRef): boolean => {
  if (selector.kind !== "contact" || !selector.actorId || !selector.part) {
    return false;
  }
  if (selector.contactId && selector.contactId !== entry.contact_id) {
    return false;
  }
  return [entry.a, entry.b].some((endpoint) => endpoint.actor_id === selector.actorId && endpoint.part === selector.part);
};

const matchEntry = (
  entry: unknown,
  outputs: ProductionOutput[],
  list: "preserve" | "recompute",
  instanceIds: readonly string[],
  contactGraph: readonly ContactGraphRef[],
  graphProvided: boolean,
  contactEdit: boolean,
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
  const contactId = query.kind === "contact" ? query.contactId : undefined;
  const graphEntry = contactId ? contactGraph.find((item) => item.contact_id === contactId) : undefined;
  if (contactId && graphProvided && !graphEntry) {
    return {
      unresolved: {
        list,
        entry: label,
        message: `contact_id "${contactId}"가 contact_graph에 없습니다.`,
      },
    };
  }
  const hits = outputs
    .filter((output) => {
      if (contactId) {
        const sameContact = output.selector.kind === "contact" && output.selector.contactId === contactId;
        const endpointPart = graphEntry ? isEndpointPart(output.selector, graphEntry) : false;
        return sameContact || endpointPart;
      }
      if (!selectorMatches(output.selector, query) && !matchesActorMotion(output.selector, query)) {
        return false;
      }
      return list === "preserve" || contactEdit || matchesInstance(output, instanceIds);
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
 * `instanceIds` filters non-contact edits. One `instanceId` is a list of length 1.
 * A contact edit (`contact_id`) does not read `instanceIds`. Its actors come from
 * `contact_graph[]` `a` and `b` for that `contact_id`. A supplied list that differs
 * is `contact_instance_conflict` and does not change the cache. The contact and
 * those endpoint parts are invalidated; other contacts are not.
 * `actor_id` narrows only a contact selector that has no `contact_id`.
 * `edit_id` and `source` are copied onto each outdated reason.
 * A `base_graph_version` other than the current graph version leaves the cache untouched.
 * This function does not write caches.
 */
export const planRevisionScope = (
  eventInput: unknown,
  snapshot: {
    outputs: unknown[];
    downstreamByNodeId: Record<string, string[]>;
    graphVersion?: string;
    contact_graph?: unknown;
  },
): RevisionPlan => {
  const eventParsed = revisionEditEventSchema.safeParse(eventInput);
  if (!eventParsed.success) {
    return { ok: false, error: "invalid_input", issues: issuesFromZod(eventParsed.error) };
  }
  const event = eventParsed.data;
  if (
    event.base_graph_version &&
    snapshot.graphVersion &&
    event.base_graph_version !== snapshot.graphVersion
  ) {
    return {
      ok: false,
      error: "stale_base_graph_version",
      message: `base_graph_version ${event.base_graph_version}는 현재 그래프 ${snapshot.graphVersion}와 달라 캐시를 바꾸지 않습니다.`,
      base_graph_version: event.base_graph_version,
      graphVersion: snapshot.graphVersion,
    };
  }
  const outputsParsed = z.array(productionOutputSchema).safeParse(snapshot.outputs);
  if (!outputsParsed.success) {
    return { ok: false, error: "invalid_input", issues: issuesFromZod(outputsParsed.error) };
  }

  const outputs = outputsParsed.data;
  let contactGraph: ContactGraphRef[] = [];
  const graphProvided = snapshot.contact_graph !== undefined;
  if (graphProvided) {
    const read = readContactGraph(snapshot.contact_graph);
    if (!read.ok) {
      return {
        ok: false,
        error: "invalid_input",
        issues: [{ path: "contact_graph", message: "contact_graph를 읽지 못했습니다." }],
      };
    }
    contactGraph = read.entries;
  }
  const referencedContactIds = unique([
    ...event.preserve.flatMap((entry) => {
      const contactId = contactIdOf(entry);
      return contactId ? [contactId] : [];
    }),
    ...event.recompute.flatMap((entry) => {
      const contactId = contactIdOf(entry);
      return contactId ? [contactId] : [];
    }),
  ]);
  const contactEdit = referencedContactIds.length > 0;
  if (contactEdit && event.instanceIds.length > 0) {
    const known = referencedContactIds.flatMap((contactId) => {
      const entry = contactGraph.find((item) => item.contact_id === contactId);
      return entry ? [entry] : [];
    });
    if (graphProvided && known.length === referencedContactIds.length) {
      const derived = unique(known.flatMap((entry) => contactGraphInstanceIds(entry)));
      if (!sameSet(event.instanceIds, derived)) {
        return {
          ok: false,
          error: "contact_instance_conflict",
          message: `contact 편집의 instanceIds가 contact_graph의 a/b와 다릅니다: ${referencedContactIds.join(", ")}`,
          contactIds: referencedContactIds,
          instanceIds: [...event.instanceIds],
          contactGraphInstanceIds: derived,
        };
      }
    }
  }

  const preserveHits = new Map<string, ScopeHit>();
  const recomputeHits = new Map<string, ScopeHit>();
  const preserveLabels = new Map<string, string[]>();
  const recomputeLabels = new Map<string, string[]>();
  const unresolved: UnresolvedScope[] = [];
  let recomputeDependentPasses = false;
  let preserveDependentPasses = false;

  const absorb = (
    list: "preserve" | "recompute",
    entry: unknown,
    hits: Map<string, ScopeHit>,
    labels: Map<string, string[]>,
  ) => {
    const matched = matchEntry(entry, outputs, list, event.instanceIds, contactGraph, graphProvided, contactEdit);
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
  const recomputedContactIds = new Set(
    event.recompute.flatMap((entry) => {
      const contactId = contactIdOf(entry);
      return contactId ? [contactId] : [];
    }),
  );

  const invalidate = new Map<string, ProductionOutput>();
  const hardLockedOutputIds: string[] = [];
  const preservedDependentIds: string[] = [];

  outputs.forEach((output) => {
    const direct = recomputeHits.has(output.outputId);
    const downstream = closure.has(output.nodeId);
    if (!direct && !downstream) {
      return;
    }
    if (
      !direct &&
      output.selector.kind === "contact" &&
      output.selector.contactId &&
      !recomputedContactIds.has(output.selector.contactId)
    ) {
      return;
    }
    if (!contactEdit && !matchesInstance(output, event.instanceIds)) {
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

  const invalidateOutputIds = Array.from(invalidate.keys());
  const reasonText = [
    event.edit_id ? `edit_id=${event.edit_id}` : "",
    event.source ? `source=${event.source.type}${event.source.transcript ? `:${event.source.transcript}` : ""}` : "",
  ].filter((part) => part.length > 0).join("; ");
  return {
    ok: true,
    shotId: event.shotId,
    operation: event.operation,
    invalidateOutputIds,
    invalidateNodeIds: unique(Array.from(invalidate.values()).map((output) => output.nodeId)),
    invalidateCacheIds: unique(Array.from(invalidate.values()).map((output) => output.cacheId)),
    preservedOutputIds: unique([...preserveHits.keys(), ...preservedDependentIds]),
    hardLockedOutputIds,
    ...(event.edit_id ? { edit_id: event.edit_id } : {}),
    ...(event.source ? { source: event.source } : {}),
    reasons: invalidateOutputIds.map((outputId) => ({
      outputId,
      ...(event.edit_id ? { edit_id: event.edit_id } : {}),
      ...(event.source ? { source: event.source } : {}),
      reason: reasonText,
    })),
  };
};
