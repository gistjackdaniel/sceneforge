import {
  actionGraphContactSchema,
  type ActionGraphContact,
  type ContactEvent,
  type RigPart,
} from "./contract";

export interface ActionGraphBinding {
  /** Graph actor_id → scene instance id. Defaults to the graph id itself. */
  actorInstanceId?: (actorId: string) => string;
  /** Graph object_id → scene instance id. Defaults to the graph id itself. */
  objectInstanceId?: (objectId: string) => string;
  /**
   * Object currently held by an actor part.
   * A place/support row names the surface (table). The cup-table marker needs the held prop.
   */
  heldObjectInstanceId?: (actorInstanceId: string, part: RigPart) => string | undefined;
}

/**
 * Map Action Graph contact rows into the viewport contact list.
 *
 * Graph `end_frame` is inclusive. Viewport ranges are half-open [start, end).
 * Does not mutate `rows`. No project or cache side effects.
 */
export const contactsFromActionGraph = (
  rows: readonly ActionGraphContact[],
  binding: ActionGraphBinding = {},
): ContactEvent[] => {
  const actorId = binding.actorInstanceId ?? ((id: string) => id);
  const objectId = binding.objectInstanceId ?? ((id: string) => id);
  const contacts: ContactEvent[] = [];
  for (const raw of rows) {
    const row = actionGraphContactSchema.parse(raw);
    const startFrame = row.start_frame;
    const endFrame = row.end_frame + 1;
    const actor = actorId(row.a.actor_id);
    if (row.b.actor_id && row.b.part) {
      contacts.push({
        contactId: row.contact_id,
        kind: "hand_hand",
        startFrame,
        endFrame,
        a: { instanceId: actor, rigPart: row.a.part },
        b: { instanceId: actorId(row.b.actor_id), rigPart: row.b.part },
        actionType: row.type,
      });
      continue;
    }
    const surfaceOrProp = row.b.object_id ? objectId(row.b.object_id) : undefined;
    if (!surfaceOrProp) continue;
    if (row.type === "place" || row.type === "support") {
      const held = binding.heldObjectInstanceId?.(actor, row.a.part);
      contacts.push({
        contactId: row.contact_id,
        kind: "object_surface",
        startFrame,
        endFrame,
        a: { instanceId: held ?? actor, rigPart: held ? undefined : row.a.part },
        b: { instanceId: surfaceOrProp },
        actionType: row.type,
      });
      continue;
    }
    contacts.push({
      contactId: row.contact_id,
      kind: "hand_object",
      startFrame,
      endFrame,
      a: { instanceId: actor, rigPart: row.a.part },
      b: { instanceId: surfaceOrProp },
      actionType: row.type,
    });
  }
  return contacts;
};
