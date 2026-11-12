import type { ActionGraph, EditSelector } from "./actionGraph";

/**
 * Envelope that Graph lane PR #32 accepts as `EditScopeInput`.
 * This branch does not import that code. `preserve` and `recompute` stay
 * the action-graph selectors, with the same objects and the same order.
 */
export type EditScopeInput = {
  shotId: string;
  operation: string;
  instanceId?: string;
  preserve: readonly EditSelector[];
  recompute: readonly EditSelector[];
};

/**
 * Map a ready edit onto `EditScopeInput`.
 * No side effects. Selector objects are not renamed or rebuilt.
 * Returns undefined when the graph has no edit.
 */
export const toEditScopeInput = (graph: ActionGraph): EditScopeInput | undefined => {
  const edit = graph.edit;
  if (!edit) return undefined;
  return {
    shotId: graph.shot_id,
    operation: edit.operation,
    preserve: edit.preserve,
    recompute: edit.recompute,
  };
};
