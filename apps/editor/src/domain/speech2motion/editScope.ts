import type { ActionGraph, EditSelector, EditSource } from "./actionGraph";

/**
 * Envelope that Graph lane PR #32 accepts as `EditScopeInput`.
 * This branch does not import that code.
 *
 * `preserve` and `recompute` stay the raw action-graph selectors, same objects
 * and same order. `core/dependency` normalizes `contact_id` and `kind: "motion"`.
 * A contact selector is `{ kind: "contact", contact_id }` only. Actors come from
 * `contact_graph`, so the selector does not carry `actor_id`.
 *
 * `instanceIds` is every `actor_id` and `object_id` on the a/b endpoints of the
 * contacts named by those selectors. One `instanceId` would be a one-element
 * list, which conflicts when a contact has more than one endpoint.
 */
export type EditScopeInput = {
  shotId: string;
  operation: string;
  instanceIds: readonly string[];
  edit_id: string;
  base_graph_version: string;
  source: EditSource;
  preserve: readonly EditSelector[];
  recompute: readonly EditSelector[];
};

const pushUnique = (ids: string[], seen: Set<string>, id: string | undefined): void => {
  if (!id || seen.has(id)) return;
  seen.add(id);
  ids.push(id);
};

const referencedContactIds = (selectors: readonly EditSelector[]): Set<string> =>
  new Set(selectors.flatMap((selector) => (selector.kind === "contact" ? [selector.contact_id] : [])));

/**
 * Instance ids #32 compares with `contact_graph` a/b.
 * Order follows `contact_graph`, then a, then b. Duplicates are dropped.
 * Contacts that no selector names are left out.
 */
export const contactScopeInstanceIds = (graph: Pick<ActionGraph, "contact_graph" | "edit">): string[] => {
  const edit = graph.edit;
  if (!edit) return [];
  const referenced = referencedContactIds([...edit.preserve, ...edit.recompute]);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const contact of graph.contact_graph) {
    if (!referenced.has(contact.contact_id)) continue;
    pushUnique(ids, seen, contact.a.actor_id);
    pushUnique(ids, seen, contact.b.actor_id);
    pushUnique(ids, seen, contact.b.object_id);
  }
  return ids;
};

/** Every contact selector names a `contact_graph` entry and has no other field. */
export const contactSelectorsMatchGraph = (graph: Pick<ActionGraph, "contact_graph" | "edit">): boolean => {
  const known = new Set(graph.contact_graph.map((contact) => contact.contact_id));
  const selectors = [...(graph.edit?.preserve ?? []), ...(graph.edit?.recompute ?? [])];
  return selectors.every((selector) => {
    if (selector.kind !== "contact") return true;
    if (!known.has(selector.contact_id)) return false;
    return Object.keys(selector).every((key) => key === "kind" || key === "contact_id");
  });
};

/**
 * Map a ready edit onto `EditScopeInput`.
 * No side effects. Selector objects are not renamed or rebuilt.
 * Returns undefined when the graph has no edit.
 * Throws when a contact selector does not match `contact_graph`.
 */
export const toEditScopeInput = (graph: ActionGraph): EditScopeInput | undefined => {
  const edit = graph.edit;
  if (!edit) return undefined;
  if (!contactSelectorsMatchGraph(graph)) {
    throw new Error("contact selector contact_id must match contact_graph.");
  }
  return {
    shotId: graph.shot_id,
    operation: edit.operation,
    instanceIds: contactScopeInstanceIds(graph),
    edit_id: edit.edit_id,
    base_graph_version: edit.base_graph_version,
    source: edit.source,
    preserve: edit.preserve,
    recompute: edit.recompute,
  };
};
