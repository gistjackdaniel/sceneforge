import type { Shot } from "../shot/types";
import { sampleCameraPose, sampleSubjectPose, selectedTake } from "../shot/queries";
import { materializeAttachments, resolveContacts, type AttachmentSpan } from "./contacts";
import { SMPLX_PART_JOINT, type ContactEvent, type InteractionPreviewRecord, type RigPart, type SubjectBinding } from "./contract";
import { SHOT_EULER_ORDER, eulerToQuaternion } from "../shot/eulerAdapter";
import {
  addVec3,
  asQuat,
  asVec3,
  midpoint,
  quatIdentity,
  quatMul,
  quatRotate,
  translationOf,
  type Quat,
  type Vec3,
} from "./math";
import type { PoseSequenceSource } from "./poseSource";
import { solveJoints } from "./rig";

export { PROXY_JOINTS } from "./rig";

interface SampledJoint {
  name: string;
  parent?: string;
  position: Vec3;
  rotation: Quat;
}

export interface SampledActor {
  subjectId: string;
  worldAssetId: string;
  label: string;
  color: string;
  root: {
    position: Vec3;
    rotationEuler: Vec3;
    eulerOrder: typeof SHOT_EULER_ORDER;
    rotation: Quat;
    scale: Vec3;
  };
  joints: SampledJoint[];
}

export interface SampledObject {
  subjectId: string;
  worldAssetId: string;
  label: string;
  color: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  parentSubjectId?: string;
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

/** One playback frame. `fps` is copied from `Shot.time.fps` so a consumer does not invent a clock. */
export interface PlaybackFrame {
  frame: number;
  fps: number;
  timeSeconds: number;
  actors: SampledActor[];
  objects: SampledObject[];
  contacts: SampledContact[];
  camera: { takeId: string; position: Vec3; rotation: Quat };
}

/** LoopClock seconds → shot-local frame, using only `shot.time`. */
export const frameAtTime = (timeSeconds: number, shot: Pick<Shot, "time">): number => {
  const frameCount = shot.time.durationFrames;
  if (frameCount <= 1) return 0;
  const frame = Math.floor(timeSeconds * shot.time.fps + 1e-6);
  return Math.max(0, Math.min(frameCount - 1, frame));
};

const jointWorld = (actor: SampledActor, part: RigPart): { position: Vec3; rotation: Quat } | undefined => {
  const name = SMPLX_PART_JOINT[part];
  const joint = actor.joints.find((item) => item.name === name);
  return joint ? { position: joint.position, rotation: joint.rotation } : undefined;
};

const sampleActor = (
  shot: Shot,
  binding: SubjectBinding,
  poses: PoseSequenceSource,
  frame: number,
): SampledActor | undefined => {
  const subject = shot.subjects.find((item) => item.id === binding.subjectId);
  const pose = poses.actorPose(binding.subjectId, frame);
  if (!subject || subject.kind === "light" || !pose) return undefined;
  const root = {
    position: asVec3(pose.position),
    rotationEuler: asVec3(pose.rotationEuler),
    eulerOrder: SHOT_EULER_ORDER,
    rotation: asQuat(eulerToQuaternion(pose.rotationEuler)),
    scale: asVec3(pose.scale),
  };
  const joints: SampledJoint[] = solveJoints(root.position, root.rotation, poses.joints(binding.subjectId, frame));
  return {
    subjectId: binding.subjectId,
    worldAssetId: subject.assetId,
    label: subject.name,
    color: binding.color,
    root,
    joints,
  };
};

const sampleObjects = (
  shot: Shot,
  preview: InteractionPreviewRecord,
  actors: readonly SampledActor[],
  attachments: readonly AttachmentSpan[],
  poses: PoseSequenceSource,
  frame: number,
): SampledObject[] => {
  const placed = new Map<string, SampledObject>();
  const pending = preview.bindings.filter((item) => item.kind !== "actor");
  const guard = pending.length + 1;
  for (let pass = 0; pass < guard && pending.length > 0; pass += 1) {
    const next: SubjectBinding[] = [];
    for (const binding of pending) {
      const subject = shot.subjects.find((item) => item.id === binding.subjectId);
      if (!subject || subject.kind === "light") continue;
      const pose = sampleSubjectPose(subject, frame);
      const streamed = poses.objectStream(binding.subjectId)?.frames.find((item) => item.t === frame);
      const attachment = attachments.find(
        (span) => span.objectSubjectId === binding.subjectId && frame >= span.frameRange[0] && frame < span.frameRange[1],
      );
      const base = {
        subjectId: binding.subjectId,
        worldAssetId: subject.assetId,
        label: subject.name,
        color: binding.color,
        scale: asVec3(pose.scale),
      };
      if (!attachment) {
        placed.set(binding.subjectId, {
          ...base,
          position: streamed ? translationOf(streamed.T_world_obj) : asVec3(pose.position),
          rotation: asQuat(eulerToQuaternion(pose.rotationEuler)),
        });
        continue;
      }
      const actor = actors.find((item) => item.subjectId === attachment.parentSubjectId);
      if (actor && attachment.rigPart) {
        const joint = jointWorld(actor, attachment.rigPart);
        if (!joint && !streamed) continue;
        placed.set(binding.subjectId, {
          ...base,
          position: streamed
            ? translationOf(streamed.T_world_obj)
            : addVec3(joint!.position, quatRotate(joint!.rotation, attachment.offset.translation)),
          rotation: joint ? quatMul(joint.rotation, attachment.offset.rotation) : asQuat(eulerToQuaternion(pose.rotationEuler)),
          parentSubjectId: attachment.parentSubjectId,
          parentRigPart: attachment.rigPart,
          sourceContactId: attachment.sourceContactId,
        });
        continue;
      }
      const parent = placed.get(attachment.parentSubjectId);
      if (!parent) {
        next.push(binding);
        continue;
      }
      placed.set(binding.subjectId, {
        ...base,
        position: streamed
          ? translationOf(streamed.T_world_obj)
          : addVec3(parent.position, quatRotate(parent.rotation, attachment.offset.translation)),
        rotation: quatMul(parent.rotation, attachment.offset.rotation),
        parentSubjectId: attachment.parentSubjectId,
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
    const actor = actors.find((item) => item.subjectId === endpoint.subjectId);
    return actor ? jointWorld(actor, endpoint.rigPart)?.position : undefined;
  }
  return objects.find((item) => item.subjectId === endpoint.subjectId)?.position;
};

const labelFor = (shot: Shot, subjectId: string): string =>
  shot.subjects.find((item) => item.id === subjectId)?.name ?? subjectId;

/**
 * Sample the shot at an integer frame.
 * Root pose and the camera come from the shot. Joints come from `poses`.
 * Does not write the shot or the preview.
 */
export const samplePlayback = (
  shot: Shot,
  preview: InteractionPreviewRecord,
  frame: number,
  poses: PoseSequenceSource,
): PlaybackFrame => {
  const last = Math.max(0, shot.time.durationFrames - 1);
  const clamped = Math.max(0, Math.min(last, Math.floor(frame)));
  const contacts = resolveContacts(preview);
  const actors = preview.bindings
    .filter((item) => item.kind === "actor")
    .flatMap((item) => {
      const actor = sampleActor(shot, item, poses, clamped);
      return actor ? [actor] : [];
    });
  const attachments = materializeAttachments(preview, contacts);
  const objects = sampleObjects(shot, preview, actors, attachments, poses, clamped);
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
      aLabel: labelFor(shot, contact.a.subjectId),
      bLabel: labelFor(shot, contact.b.subjectId),
    });
  }
  const take = selectedTake(shot);
  const idle: PlaybackFrame["camera"] = { takeId: take?.id ?? "", position: [0, 1.6, 3], rotation: quatIdentity() };
  const sampledCamera = take && shot.camera.status === "ready"
    ? sampleCameraPose(take, clamped, shot.camera.interpolation)
    : undefined;
  const camera: PlaybackFrame["camera"] = sampledCamera && take
    ? { takeId: take.id, position: asVec3(sampledCamera.position), rotation: asQuat(sampledCamera.rotation) }
    : idle;
  return {
    frame: clamped,
    fps: shot.time.fps,
    timeSeconds: clamped / shot.time.fps,
    actors,
    objects,
    contacts: markers,
    camera,
  };
};

export const jointPosition = (actor: SampledActor, jointName: string): Vec3 | undefined =>
  actor.joints.find((joint) => joint.name === jointName)?.position;

/** Local joint rotations from the pose source, one entry per shot frame. */
export const resolvedJointTrack = (
  shot: Shot,
  subjectId: string,
  poses: PoseSequenceSource,
): Array<{ frame: number; joints: Record<string, Quat> }> => {
  const frames: Array<{ frame: number; joints: Record<string, Quat> }> = [];
  for (let frame = 0; frame < shot.time.durationFrames; frame += 1) {
    frames.push({ frame, joints: { ...poses.joints(subjectId, frame) } });
  }
  return frames;
};
