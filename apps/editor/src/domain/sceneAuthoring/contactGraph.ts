import type { RigPart } from "./contract";

/**
 * Two-person contact, in the action-graph shape.
 * `actionGraph.ts` is not on this branch, so this fixture is local and is not imported from there.
 * Frame fields are half-open shot frames: `[start_frame, end_frame)`.
 */
export interface ContactGraphEntry {
  contact_id: string;
  a: { actor_id: string; part: RigPart };
  b: { actor_id?: string; object_id?: string; part?: RigPart };
  start_frame: number;
  end_frame: number;
  type: "grasp" | "strike" | "support" | "place";
}

/** Names a contact span. Actors and parts are not stored here — read them from `contact_graph[]`. */
export interface ContactRangeRef {
  kind: "contact";
  contact_id: string;
}

export const readContact = (
  contactGraph: readonly ContactGraphEntry[],
  ref: ContactRangeRef,
): ContactGraphEntry => {
  const entry = contactGraph.find((item) => item.contact_id === ref.contact_id);
  if (!entry) {
    throw new Error(`contact_graph에 ${ref.contact_id}가 없습니다.`);
  }
  return entry;
};
