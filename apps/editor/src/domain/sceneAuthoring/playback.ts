import type {
  ActorPoseClip,
  AttachmentSpan,
  ContactEffectorOverride,
  ContactEvent,
  InteractiveScene,
  ObjectRest,
  PoseChannel,
  RigPart,
  RootSample,
  RotationKey,
} from "./contract";
import { PROXY_PART_JOINT } from "./contract";
import {
  addVec3,
  lerpVec3,
  midpoint,
  quatFromAxisAngle,
  quatIdentity,
  quatMul,
  quatRotate,
  quatSlerp,
  type Quat,
  type Vec3,
} from "./math";

export interface ProxyJoint {
  name: string;
  parent: string | null;
  translation: Vec3;
  rigPart?: RigPart;
}

/** Proxy skeleton. Local offsets are meters in the parent joint frame. +Z is forward. */
export const PROXY_JOINTS: readonly ProxyJoint[] = [
  { name: "pelvis", parent: null, translation: [0, 0.95, 0], rigPart: "pelvis" },
  { name: "spine", parent: "pelvis", translation: [0, 0.22, 0] },
  { name: "head", parent: "spine", translation: [0, 0.24, 0], rigPart: "head" },
  { name: "left_shoulder", parent: "spine", translation: [-0.18, 0.16, 0] },
  { name: "left_elbow", parent: "left_shoulder", translation: [0, -0.27, 0] },
  { name: "left_wrist", parent: "left_elbow", translation: [0, -0.25, 0], rigPart: "left_hand" },
  { name: "right_shoulder", parent: "spine", translation: [0.18, 0.16, 0] },
  { name: "right_elbow", parent: "right_shoulder", translation: [0, -0.27, 0] },
  { name: "right_wrist", parent: "right_elbow", translation: [0, -0.25, 0], rigPart: "right_hand" },
];

const sidePrefix = (part: RigPart): "left" | "right" | undefined => {
  if (part.startsWith("left_")) return "left";
  if (part.startsWith("right_")) return "right";
  return undefined;
};

/**
 * The reach is authored on the original hand. The other hand sits on the opposite
 * side of the body, so a pure rename would miss the partner. This yaw is only a
 * preview stand-in. Video lane's IK replaces it.
 */
const crossBodySwing = (rotation: Quat, from: RigPart, to: RigPart): Quat => {
  if (from === to) return rotation;
  const yaw = to === "right_hand" ? -1.15 : to === "left_hand" ? 1.15 : 0;
  if (yaw === 0) return rotation;
  return quatMul(quatFromAxisAngle([0, 1, 0], yaw), rotation);
};

/** Move a channel authored on one hand onto the other. Rig-part vocabulary only; instance ids are not parsed. */
export const retargetJointName = (jointName: string, from: RigPart, to: RigPart): string => {
  if (from === to) return jointName;
  const fromSide = sidePrefix(from);
  const toSide = sidePrefix(to);
  if (!fromSide || !toSide) return jointName;
  const prefix = `${fromSide}_`;
  if (!jointName.startsWith(prefix)) return jointName;
  return `${toSide}_${jointName.slice(prefix.length)}`;
};

/**
 * Resolved contacts. Source `scene.contacts` is not modified.
 * An override replaces the effector of the named instance on that contact.
 */
export const resolveContacts = (scene: InteractiveScene): ContactEvent[] =>
  scene.contacts.map((contact) => applyOverride(contact, scene.overrides));

const applyOverride = (contact: ContactEvent, overrides: readonly ContactEffectorOverride[]): ContactEvent => {
  const override = overrides.find((item) => item.contactId === contact.contactId);
  if (!override) return contact;
  if (contact.a.instanceId === override.instanceId) {
    return { ...contact, a: { ...contact.a, rigPart: override.rigPart } };
  }
  if (contact.b.instanceId === override.instanceId) {
    return { ...contact, b: { ...contact.b, rigPart: override.rigPart } };
  }
  return contact;
};

export const resolvedRigPart = (
  channel: PoseChannel,
  contacts: readonly ContactEvent[],
): RigPart => {
  if (!channel.contactId) return channel.rigPart;
  const contact = contacts.find((item) => item.contactId === channel.contactId);
  if (!contact) return channel.rigPart;
  if (contact.a.instanceId === channel.actorInstanceId && contact.a.rigPart) return contact.a.rigPart;
  if (contact.b.instanceId === channel.actorInstanceId && contact.b.rigPart) return contact.b.rigPart;
  return channel.rigPart;
};

/**
 * Attachment cache. Contact graph is the source of truth; this only materializes it.
 * Handshake edits do not change a hold/place contact, so the cup's parents stay put.
 */
export const materializeAttachments = (
  scene: InteractiveScene,
  contacts: readonly ContactEvent[] = resolveContacts(scene),
): AttachmentSpan[] => {
  const spans: AttachmentSpan[] = [];
  for (const contact of contacts) {
    if (contact.kind === "hand_object") {
      const actor = contact.a.rigPart ? contact.a : contact.b;
      const object = contact.a.rigPart ? contact.b : contact.a;
      if (!actor.rigPart) continue;
      spans.push({
        objectInstanceId: object.instanceId,
        parentInstanceId: actor.instanceId,
        rigPart: actor.rigPart,
        offset: offsetFor(scene, object.instanceId, contact.contactId),
        frameRange: [contact.startFrame, contact.endFrame],
        sourceContactId: contact.contactId,
      });
      continue;
    }
    if (contact.kind === "object_surface") {
      const prop = propEndpoint(scene, contact);
      if (!prop) continue;
      const surface = prop.instanceId === contact.a.instanceId ? contact.b : contact.a;
      spans.push({
        objectInstanceId: prop.instanceId,
        parentInstanceId: surface.instanceId,
        offset: offsetFor(scene, prop.instanceId, contact.contactId),
        frameRange: [contact.startFrame, contact.endFrame],
        sourceContactId: contact.contactId,
      });
    }
  }
  return spans;
};

const ZERO: Vec3 = [0, 0, 0];

const offsetFor = (scene: InteractiveScene, objectInstanceId: string, contactId: string) => {
  const object = scene.objects.find((item) => item.instanceId === objectInstanceId);
  return object?.attachmentOffsets[contactId] ?? { translation: ZERO, rotation: quatIdentity() };
};

const propEndpoint = (scene: InteractiveScene, contact: ContactEvent) => {
  const a = scene.objects.find((item) => item.instanceId === contact.a.instanceId);
  const b = scene.objects.find((item) => item.instanceId === contact.b.instanceId);
  if (a?.role === "prop") return contact.a;
  if (b?.role === "prop") return contact.b;
  return undefined;
};

interface SampledJoint {
  name: string;
  parent?: string;
  position: Vec3;
  rotation: Quat;
}

export interface SampledActor {
  instanceId: string;
  worldAssetId: string;
  label: string;
  color: string;
  root: { translation: Vec3; rotation: Quat };
  joints: SampledJoint[];
}

export interface SampledObject {
  instanceId: string;
  worldAssetId: string;
  label: string;
  color: string;
  position: Vec3;
  rotation: Quat;
  parentInstanceId?: string;
  parentRigPart?: RigPart;
  sourceContactId?: string;
}

export interface SampledContact {
  contactId: string;
  kind: ContactEvent["kind"];
  position: Vec3;
  aLabel: string;
  bLabel: string;
}

export interface PlaybackFrame {
  frame: number;
  timeSeconds: number;
  actors: SampledActor[];
  objects: SampledObject[];
  contacts: SampledContact[];
  camera: { position: Vec3; rotation: Quat; cameraTrackId: string };
}

/** LoopClock seconds → shot-local frame. Clamps to the scene. */
export const frameAtTime = (timeSeconds: number, fps: number, frameCount: number): number => {
  if (frameCount <= 1) return 0;
  const frame = Math.floor(timeSeconds * Math.max(fps, 1) + 1e-6);
  return Math.max(0, Math.min(frameCount - 1, frame));
};

const sampleKeys = <T extends { frame: number }>(keys: readonly T[], frame: number): { left: T; right: T; t: number } | undefined => {
  if (keys.length === 0) return undefined;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return { left: sorted[0], right: sorted[0], t: 0 };
  if (frame >= sorted[sorted.length - 1].frame) {
    const last = sorted[sorted.length - 1];
    return { left: last, right: last, t: 0 };
  }
  let index = 1;
  while (index < sorted.length && sorted[index].frame < frame) index += 1;
  const right = sorted[index];
  const left = sorted[index - 1];
  const span = right.frame - left.frame;
  return { left, right, t: span > 0 ? (frame - left.frame) / span : 0 };
};

const sampleRoot = (samples: readonly RootSample[], frame: number): { translation: Vec3; rotation: Quat } => {
  const hit = sampleKeys(samples, frame);
  if (!hit) return { translation: [0, 0, 0], rotation: quatIdentity() };
  return {
    translation: lerpVec3(hit.left.translation, hit.right.translation, hit.t),
    rotation: quatSlerp(hit.left.rotation, hit.right.rotation, hit.t),
  };
};

const channelCovers = (keys: readonly RotationKey[], frame: number): boolean => {
  if (keys.length === 0) return false;
  const frames = keys.map((key) => key.frame);
  return frame >= Math.min(...frames) && frame <= Math.max(...frames);
};

const sampleRotation = (keys: readonly RotationKey[], frame: number): Quat | undefined => {
  if (!channelCovers(keys, frame)) return undefined;
  const hit = sampleKeys(keys, frame);
  if (!hit) return undefined;
  return quatSlerp(hit.left.rotation, hit.right.rotation, hit.t);
};

const jointRotationsForActor = (
  pose: ActorPoseClip | undefined,
  contacts: readonly ContactEvent[],
  frame: number,
): Map<string, Quat> => {
  const rotations = new Map<string, Quat>();
  if (!pose) return rotations;
  for (const channel of pose.channels) {
    const targetPart = resolvedRigPart(channel, contacts);
    for (const [jointName, keys] of Object.entries(channel.joints)) {
      const rotation = sampleRotation(keys, frame);
      if (!rotation) continue;
      const jointNameOnTarget = retargetJointName(jointName, channel.rigPart, targetPart);
      const swung = jointName.endsWith("shoulder") ? crossBodySwing(rotation, channel.rigPart, targetPart) : rotation;
      rotations.set(jointNameOnTarget, swung);
    }
  }
  return rotations;
};

const sampleActor = (
  scene: InteractiveScene,
  pose: ActorPoseClip,
  contacts: readonly ContactEvent[],
  frame: number,
): SampledActor => {
  const subject = scene.subjects.find((item) => item.instanceId === pose.instanceId);
  const root = sampleRoot(pose.root, frame);
  const localRotation = jointRotationsForActor(pose, contacts, frame);
  const world = new Map<string, { position: Vec3; rotation: Quat }>();
  const joints: SampledJoint[] = [];
  for (const joint of PROXY_JOINTS) {
    const parent = joint.parent ? world.get(joint.parent) : { position: root.translation, rotation: root.rotation };
    const origin = parent ?? { position: root.translation, rotation: root.rotation };
    const localQ = localRotation.get(joint.name) ?? quatIdentity();
    const rotation = quatMul(origin.rotation, localQ);
    const position = addVec3(origin.position, quatRotate(origin.rotation, joint.translation));
    world.set(joint.name, { position, rotation });
    joints.push({ name: joint.name, parent: joint.parent ?? undefined, position, rotation });
  }
  return {
    instanceId: pose.instanceId,
    worldAssetId: subject?.worldAssetId ?? "",
    label: subject?.label ?? pose.instanceId,
    color: subject?.color ?? "#cccccc",
    root,
    joints,
  };
};

const jointWorld = (actor: SampledActor, part: RigPart): { position: Vec3; rotation: Quat } | undefined => {
  const name = PROXY_PART_JOINT[part];
  return actor.joints.find((joint) => joint.name === name);
};

const sampleObjects = (
  scene: InteractiveScene,
  actors: readonly SampledActor[],
  attachments: readonly AttachmentSpan[],
  frame: number,
): SampledObject[] => {
  const placed = new Map<string, SampledObject>();
  const pending = [...scene.objects];
  const guard = pending.length + 1;
  for (let pass = 0; pass < guard && pending.length > 0; pass += 1) {
    const next: ObjectRest[] = [];
    for (const object of pending) {
      const subject = scene.subjects.find((item) => item.instanceId === object.instanceId);
      const attachment = attachments.find(
        (span) =>
          span.objectInstanceId === object.instanceId && frame >= span.frameRange[0] && frame < span.frameRange[1],
      );
      if (!attachment) {
        placed.set(object.instanceId, {
          instanceId: object.instanceId,
          worldAssetId: object.worldAssetId,
          label: subject?.label ?? object.instanceId,
          color: subject?.color ?? "#cccccc",
          position: object.rest.translation,
          rotation: object.rest.rotation,
        });
        continue;
      }
      const actor = actors.find((item) => item.instanceId === attachment.parentInstanceId);
      if (actor && attachment.rigPart) {
        const joint = jointWorld(actor, attachment.rigPart);
        if (!joint) continue;
        placed.set(object.instanceId, {
          instanceId: object.instanceId,
          worldAssetId: object.worldAssetId,
          label: subject?.label ?? object.instanceId,
          color: subject?.color ?? "#cccccc",
          position: addVec3(joint.position, quatRotate(joint.rotation, attachment.offset.translation)),
          rotation: quatMul(joint.rotation, attachment.offset.rotation),
          parentInstanceId: attachment.parentInstanceId,
          parentRigPart: attachment.rigPart,
          sourceContactId: attachment.sourceContactId,
        });
        continue;
      }
      const parent = placed.get(attachment.parentInstanceId);
      if (!parent) {
        next.push(object);
        continue;
      }
      placed.set(object.instanceId, {
        instanceId: object.instanceId,
        worldAssetId: object.worldAssetId,
        label: subject?.label ?? object.instanceId,
        color: subject?.color ?? "#cccccc",
        position: addVec3(parent.position, quatRotate(parent.rotation, attachment.offset.translation)),
        rotation: quatMul(parent.rotation, attachment.offset.rotation),
        parentInstanceId: attachment.parentInstanceId,
        sourceContactId: attachment.sourceContactId,
      });
    }
    if (next.length === pending.length) break;
    pending.length = 0;
    pending.push(...next);
  }
  return [...placed.values()];
};

const endpointPosition = (
  endpoint: ContactEvent["a"],
  actors: readonly SampledActor[],
  objects: readonly SampledObject[],
): Vec3 | undefined => {
  if (endpoint.rigPart) {
    const actor = actors.find((item) => item.instanceId === endpoint.instanceId);
    return actor ? jointWorld(actor, endpoint.rigPart)?.position : undefined;
  }
  return objects.find((item) => item.instanceId === endpoint.instanceId)?.position;
};

const labelFor = (scene: InteractiveScene, instanceId: string): string =>
  scene.subjects.find((item) => item.instanceId === instanceId)?.label ?? instanceId;

/**
 * Sample the scene at a shot-local frame.
 * Reads poses, resolved contacts, and object rests. Does not write the scene.
 */
export const samplePlayback = (scene: InteractiveScene, frame: number): PlaybackFrame => {
  const clamped = Math.max(0, Math.min(scene.frameCount - 1, Math.floor(frame)));
  const contacts = resolveContacts(scene);
  const actors = scene.poses.map((pose) => sampleActor(scene, pose, contacts, clamped));
  const attachments = materializeAttachments(scene, contacts);
  const objects = sampleObjects(scene, actors, attachments, clamped);
  const active = contacts.filter((contact) => clamped >= contact.startFrame && clamped < contact.endFrame);
  const markers: SampledContact[] = [];
  for (const contact of active) {
    const a = endpointPosition(contact.a, actors, objects);
    const b = endpointPosition(contact.b, actors, objects);
    if (!a || !b) continue;
    markers.push({
      contactId: contact.contactId,
      kind: contact.kind,
      position: midpoint(a, b),
      aLabel: labelFor(scene, contact.a.instanceId),
      bLabel: labelFor(scene, contact.b.instanceId),
    });
  }
  const cameraHit = sampleKeys(scene.camera.samples, clamped);
  const idleCamera: PlaybackFrame["camera"] = {
    position: [0, 1.6, 3],
    rotation: quatIdentity(),
    cameraTrackId: scene.camera.cameraTrackId,
  };
  const camera: PlaybackFrame["camera"] = cameraHit
    ? {
        position: lerpVec3(cameraHit.left.position, cameraHit.right.position, cameraHit.t),
        rotation: quatSlerp(cameraHit.left.rotation, cameraHit.right.rotation, cameraHit.t),
        cameraTrackId: scene.camera.cameraTrackId,
      }
    : idleCamera;
  return {
    frame: clamped,
    timeSeconds: clamped / scene.fps,
    actors,
    objects,
    contacts: markers,
    camera,
  };
};

export const jointPosition = (actor: SampledActor, jointName: string): Vec3 | undefined =>
  actor.joints.find((joint) => joint.name === jointName)?.position;

/** Local joint rotations after effector resolution, one entry per frame. Used to prove B's motion changed. */
export const resolvedJointTrack = (scene: InteractiveScene, instanceId: string): Array<{ frame: number; joints: Record<string, Quat> }> => {
  const pose = scene.poses.find((item) => item.instanceId === instanceId);
  const contacts = resolveContacts(scene);
  const frames: Array<{ frame: number; joints: Record<string, Quat> }> = [];
  for (let frame = 0; frame < scene.frameCount; frame += 1) {
    const rotations = jointRotationsForActor(pose, contacts, frame);
    frames.push({ frame, joints: Object.fromEntries(rotations) });
  }
  return frames;
};
