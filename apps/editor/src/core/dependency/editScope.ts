import {
  DEPENDENT_RENDER_PASSES,
  normalizeProductionSelector,
  selectorScopeToken,
  selectorToQuery,
  tokenToSelectorQuery,
  type SelectorQuery,
} from "./selector";

/**
 * Narrow input for an edit. Field names follow `actionGraph.ts` (`edit_id`,
 * `base_graph_version`, `source`, `preserve`, `recompute`). That module is not
 * on this branch, so this is a structural type and not a second schema.
 * A single `instanceId` is stored here as a one-element `instanceIds`.
 * `instanceIds` applies only to edits that do not name a `contact_id`.
 * A contact edit derives its actors from `contact_graph[].a/b`.
 */
export interface EditSourceInput {
  type: "voice" | "text" | "manual";
  transcript?: string;
}

export interface EditScopeInput {
  shotId: string;
  operation: string;
  /** Non-contact edits only. A contact edit derives actors from `contact_graph`. */
  instanceIds: readonly string[];
  edit_id?: string;
  base_graph_version?: string;
  source?: EditSourceInput;
  preserve: readonly unknown[];
  recompute: readonly unknown[];
}

/** Shot-record units a list item may name. Not the producer schema. */
export type ShotEntityScope =
  | { entity: "pose"; subjectId: string; channel: "root_motion" | "contact_hand" }
  | { entity: "camera_take"; takeId?: string }
  | { entity: "room" | "background"; worldId?: string }
  | { entity: "prop"; subjectId: string }
  | { entity: "actor"; subjectId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** Contact-hand pose of one stage subject. The shot stores a single motion channel. */
export const contactHandId = (subjectId: string): string => `${subjectId}:contact_hand`;

export const contactHandDownstreamId = (subjectId: string): string => `${subjectId}:contact_hand_downstream`;

export const scopeLabel = (entry: unknown): string => {
  if (typeof entry === "string") {
    return entry;
  }
  if (!isRecord(entry)) {
    return "invalid";
  }
  const selector = normalizeProductionSelector(entry);
  if (selector && selector !== "dependent") {
    return selectorScopeToken(selector);
  }
  if (selector === "dependent") {
    return DEPENDENT_RENDER_PASSES;
  }
  if (entry.entity === "pose" && typeof entry.subjectId === "string") {
    return `pose:${entry.subjectId}:${String(entry.channel ?? "")}`;
  }
  if (entry.entity === "camera_take") {
    return "camera";
  }
  if (entry.entity === "room" || entry.entity === "background") {
    return "room/background";
  }
  if (entry.entity === "prop" && typeof entry.subjectId === "string") {
    return `prop:${entry.subjectId}`;
  }
  if (entry.entity === "actor" && typeof entry.subjectId === "string") {
    return `actor:${entry.subjectId}`;
  }
  return typeof entry.kind === "string" ? entry.kind : "invalid";
};

export type InterpretedScope =
  | { query: SelectorQuery }
  | { dependent: true }
  | { unresolved: true; label: string };

/**
 * Read one preserve/recompute item.
 * Strings and dependency selectors stay as they were. Shot entities and the
 * producer field names (`actor_id`, `contact_id`, `background`) map onto the
 * same selector grammar. This does not validate an action graph.
 */
export const interpretScopeEntry = (entry: unknown): InterpretedScope => {
  const label = scopeLabel(entry);
  if (typeof entry === "string") {
    const query = tokenToSelectorQuery(entry);
    if (query === undefined) {
      return { unresolved: true, label };
    }
    if (query === DEPENDENT_RENDER_PASSES) {
      return { dependent: true };
    }
    return { query };
  }
  if (!isRecord(entry)) {
    return { unresolved: true, label };
  }

  const normalized = normalizeProductionSelector(entry);
  if (normalized === "dependent") {
    return { dependent: true };
  }
  if (normalized) {
    return { query: selectorToQuery(normalized) };
  }

  const subjectId = text(entry.subjectId);
  if (entry.entity === "pose" && subjectId) {
    if (entry.channel === "contact_hand") {
      return { query: { kind: "contact", contactId: contactHandId(subjectId) } };
    }
    if (entry.channel === "root_motion") {
      return { query: { kind: "actor", actorId: subjectId, motion: "root_motion" } };
    }
  }
  if (entry.entity === "camera_take") {
    const takeId = text(entry.takeId);
    return { query: { kind: "camera_track", ...(takeId ? { cameraTrackId: takeId } : {}) } };
  }
  if (entry.entity === "room" || entry.entity === "background") {
    const worldId = text(entry.worldId);
    return { query: { kind: "set_layout", ...(worldId ? { setLayoutId: worldId } : {}) } };
  }
  if (entry.entity === "prop" && subjectId) {
    return { query: { kind: "object", objectId: subjectId } };
  }
  if (entry.entity === "actor" && subjectId) {
    return { query: { kind: "actor", actorId: subjectId, motion: "motion" } };
  }

  return { unresolved: true, label };
};
