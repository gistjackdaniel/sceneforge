import type {
  ContactEffectorOverride,
  ContactEvent,
  InteractionPreviewRecord,
  RigPart,
  SubjectBinding,
} from "./contract";
import { quatIdentity, type Quat, type Vec3 } from "./math";

export interface EffectorChannel {
  subjectId: string;
  rigPart: RigPart;
  contactId?: string;
}

/** Resolved contacts. Source `preview.contacts` is not modified. */
export const resolveContacts = (preview: InteractionPreviewRecord): ContactEvent[] =>
  preview.contacts.map((contact) => applyOverride(contact, preview.overrides));

const applyOverride = (contact: ContactEvent, overrides: readonly ContactEffectorOverride[]): ContactEvent => {
  const override = overrides.find((item) => item.contactId === contact.contactId);
  if (!override) return contact;
  if (contact.a.subjectId === override.subjectId) {
    return { ...contact, a: { ...contact.a, rigPart: override.rigPart } };
  }
  if (contact.b.subjectId === override.subjectId) {
    return { ...contact, b: { ...contact.b, rigPart: override.rigPart } };
  }
  return contact;
};

export const resolvedRigPart = (channel: EffectorChannel, contacts: readonly ContactEvent[]): RigPart => {
  if (!channel.contactId) return channel.rigPart;
  const contact = contacts.find((item) => item.contactId === channel.contactId);
  if (!contact) return channel.rigPart;
  if (contact.a.subjectId === channel.subjectId && contact.a.rigPart) return contact.a.rigPart;
  if (contact.b.subjectId === channel.subjectId && contact.b.rigPart) return contact.b.rigPart;
  return channel.rigPart;
};

export interface AttachmentSpan {
  objectSubjectId: string;
  parentSubjectId: string;
  rigPart?: RigPart;
  offset: { translation: Vec3; rotation: Quat };
  frameRange: [number, number];
  sourceContactId?: string;
}

const ZERO: Vec3 = [0, 0, 0];

const offsetFor = (preview: InteractionPreviewRecord, objectSubjectId: string, contactId: string) => {
  const stored = preview.attachmentOffsets[objectSubjectId]?.[contactId];
  if (!stored) return { translation: ZERO, rotation: quatIdentity() };
  return {
    translation: [stored.translation[0], stored.translation[1], stored.translation[2]] as Vec3,
    rotation: [stored.rotation[0], stored.rotation[1], stored.rotation[2], stored.rotation[3]] as Quat,
  };
};

const binding = (preview: InteractionPreviewRecord, subjectId: string): SubjectBinding | undefined =>
  preview.bindings.find((item) => item.subjectId === subjectId);

/**
 * Attachment cache. The contact list is the source of truth.
 * A handshake override does not rewrite hold/place contacts, so the cup's parents stay put.
 */
export const materializeAttachments = (
  preview: InteractionPreviewRecord,
  contacts: readonly ContactEvent[] = resolveContacts(preview),
): AttachmentSpan[] => {
  const spans: AttachmentSpan[] = [];
  for (const contact of contacts) {
    if (contact.kind === "hand_object") {
      const actor = contact.a.rigPart ? contact.a : contact.b;
      const object = contact.a.rigPart ? contact.b : contact.a;
      if (!actor.rigPart) continue;
      spans.push({
        objectSubjectId: object.subjectId,
        parentSubjectId: actor.subjectId,
        rigPart: actor.rigPart,
        offset: offsetFor(preview, object.subjectId, contact.contactId),
        frameRange: [contact.startFrame, contact.endFrame],
        sourceContactId: contact.contactId,
      });
      continue;
    }
    if (contact.kind === "object_surface") {
      const a = binding(preview, contact.a.subjectId);
      const b = binding(preview, contact.b.subjectId);
      const prop = a?.kind === "prop" ? contact.a : b?.kind === "prop" ? contact.b : undefined;
      if (!prop) continue;
      const surface = prop.subjectId === contact.a.subjectId ? contact.b : contact.a;
      spans.push({
        objectSubjectId: prop.subjectId,
        parentSubjectId: surface.subjectId,
        offset: offsetFor(preview, prop.subjectId, contact.contactId),
        frameRange: [contact.startFrame, contact.endFrame],
        sourceContactId: contact.contactId,
      });
    }
  }
  return spans;
};
