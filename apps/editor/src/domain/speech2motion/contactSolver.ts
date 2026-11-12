import type { ContactGraph, RigPart } from "./actionGraph";
import type { ActorPoseSequence } from "./motionModel";
import { GENERATED_MOTION_SOURCE, worldTransform, type ObjectAttachment, type ObjectPoseStream } from "./objectStream";
import { PHASE0_CUP_HALF_HEIGHT_M, PHASE0_CUP_IN_HAND_OFFSET, composeWorldPose } from "./phase0Fixture";
import { QuatMath, SmplxSkeleton, TwoBoneIk, Vec, type PoseFrame, type Quat, type Vec3 } from "./pose";

export interface PlacementSource {
  position: Vec3;
  subjectId?: string;
}

export interface SolvedContact {
  contactId: string;
  type: ContactGraph["type"];
  startFrame: number;
  endFrame: number;
  a: { actorId: string; part: RigPart };
  b: { actorId?: string; objectId?: string; part?: RigPart };
  resolved: boolean;
  reason?: string;
}

export interface ContactSolveResult {
  sequences: readonly ActorPoseSequence[];
  objects: readonly ObjectPoseStream[];
  attachments: readonly ObjectAttachment[];
  contacts: readonly SolvedContact[];
}

/**
 * Fits grasp and place contacts with 2-bone IK.
 * Actor-to-actor contacts move endpoint `b` only, so the anchor actor's pose stays put.
 * Object ids are not looked up here. The caller passes positions that already came from TargetResolver.
 */
export class ContactSolver {
  static readonly surfaceQuery = "table";

  static solve(input: {
    sequences: readonly ActorPoseSequence[];
    contacts: readonly ContactGraph[];
    frameCount: number;
    locateObject: (objectId: string) => PlacementSource | undefined;
    locateSurface: (query: string) => PlacementSource | undefined;
    /**
     * World pose of the holding hand. When set for `left_hand`, the cup follows
     * that pose times the hand-local offset instead of a generic wrist lerp.
     */
    handWorldPose?: (frame: number, part: RigPart) => { translation: Vec3; rotation: Quat } | undefined;
  }): ContactSolveResult {
    const original = ContactSolver.cloneSequences(input.sequences);
    let sequences = ContactSolver.cloneSequences(input.sequences);
    const contacts: SolvedContact[] = [];

    for (const contact of input.contacts) {
      const record: SolvedContact = {
        contactId: contact.contact_id,
        type: contact.type,
        startFrame: contact.start_frame,
        endFrame: contact.end_frame,
        a: { actorId: contact.a.actor_id, part: contact.a.part },
        b: { actorId: contact.b.actor_id, objectId: contact.b.object_id, part: contact.b.part },
        resolved: false,
      };
      if (contact.b.actor_id && contact.b.part && !contact.b.object_id) {
        const grasped = ContactSolver.solveHandshake(sequences, original, contact);
        sequences = grasped.sequences;
        record.resolved = grasped.resolved;
        record.reason = grasped.reason;
      } else if (!contact.b.object_id) {
        record.reason = "접촉 대상이 없습니다.";
      }
      contacts.push(record);
    }

    const objects = ContactSolver.objectStreams(
      sequences,
      input.contacts,
      input.frameCount,
      input.locateObject,
      input.locateSurface,
      contacts,
      input.handWorldPose,
    );
    return { sequences: objects.sequences, objects: objects.streams, attachments: objects.attachments, contacts };
  }

  private static solveHandshake(
    sequences: readonly ActorPoseSequence[],
    original: readonly ActorPoseSequence[],
    contact: ContactGraph,
  ): { sequences: ActorPoseSequence[]; resolved: boolean; reason?: string } {
    const drivenId = contact.b.actor_id;
    const drivenPart = contact.b.part;
    if (!drivenId || !drivenPart) return { sequences: [...sequences], resolved: false, reason: "접촉 대상이 없습니다." };
    const limb = SmplxSkeleton.limb(drivenPart);
    if (!limb) {
      return { sequences: [...sequences], resolved: false, reason: `${drivenPart}는 2-bone 사슬이 아닙니다.` };
    }
    const anchor = original.find((sequence) => sequence.actorId === contact.a.actor_id);
    const drivenIndex = sequences.findIndex((sequence) => sequence.actorId === drivenId);
    if (!anchor || drivenIndex < 0) {
      return { sequences: [...sequences], resolved: false, reason: "접촉 배우의 포즈가 없습니다." };
    }
    const anchorLimb = SmplxSkeleton.limb(contact.a.part);
    if (!anchorLimb) {
      return { sequences: [...sequences], resolved: false, reason: `${contact.a.part}는 2-bone 사슬이 아닙니다.` };
    }
    const next = sequences.map((sequence) => ({ ...sequence, frames: sequence.frames.map(ContactSolver.cloneFrame) }));
    const driven = next[drivenIndex]!;
    driven.frames = driven.frames.map((frame) => {
      if (frame.frame < contact.start_frame || frame.frame > contact.end_frame) return frame;
      const anchorFrame = anchor.frames.find((item) => item.frame === frame.frame);
      const target = anchorFrame?.joints[anchorLimb.end]?.translation;
      if (!target) return frame;
      return { frame: frame.frame, joints: TwoBoneIk.solve(frame.joints, limb, target) };
    });
    return { sequences: next, resolved: true };
  }

  /**
   * Cup motion stays a dense `T_world_obj` per integer frame.
   * The initial parent is the actor on endpoint `a` (the holder). A place contact
   * moves that hand toward the table, then parents the object to the surface with no `rigPart`.
   * Sparse-key baking is intentionally absent.
   */
  private static objectStreams(
    sequences: readonly ActorPoseSequence[],
    contacts: readonly ContactGraph[],
    frameCount: number,
    locateObject: (objectId: string) => PlacementSource | undefined,
    locateSurface: (query: string) => PlacementSource | undefined,
    solved: SolvedContact[],
    handWorldPose?: (frame: number, part: RigPart) => { translation: Vec3; rotation: Quat } | undefined,
  ): { sequences: ActorPoseSequence[]; streams: ObjectPoseStream[]; attachments: ObjectAttachment[] } {
    const next = sequences.map((sequence) => ({ ...sequence, frames: sequence.frames.map(ContactSolver.cloneFrame) }));
    const streams: ObjectPoseStream[] = [];
    const attachments: ObjectAttachment[] = [];
    const objectIds = [...new Set(contacts.flatMap((contact) => (contact.b.object_id ? [contact.b.object_id] : [])))];

    for (const objectId of objectIds) {
      const related = contacts.filter((contact) => contact.b.object_id === objectId);
      const object = locateObject(objectId);
      const mark = (contact: ContactGraph, resolved: boolean, reason?: string) => {
        const row = solved.find((item) => item.contactId === contact.contact_id);
        if (!row) return;
        row.resolved = resolved;
        row.reason = reason;
      };
      if (!object) {
        for (const contact of related) mark(contact, false, "TargetResolver가 오브젝트를 찾지 못했습니다.");
        continue;
      }
      const hold = related.find((contact) => contact.type === "grasp") ?? related.find((contact) => contact.type !== "place");
      const place = related.find((contact) => contact.type === "place");
      const holder = hold ?? place;
      if (!holder) continue;
      const limb = SmplxSkeleton.limb(holder.a.part);
      const actorIndex = next.findIndex((sequence) => sequence.actorId === holder.a.actor_id);
      if (!limb || actorIndex < 0) {
        for (const contact of related) mark(contact, false, `${holder.a.part} 사슬 또는 배우 포즈가 없습니다.`);
        continue;
      }
      let surface = object;
      if (place) {
        const table = locateSurface(ContactSolver.surfaceQuery);
        if (!table) {
          for (const contact of related) mark(contact, false, "TargetResolver가 테이블을 찾지 못했습니다.");
          continue;
        }
        surface = table;
      }
      const release = hold ? hold.end_frame + 1 : (place?.start_frame ?? 0);
      const approachStart = place?.start_frame ?? release;
      const localOffset = PHASE0_CUP_IN_HAND_OFFSET;
      const tablePosition: Vec3 = place
        ? [surface.position[0], surface.position[1] + PHASE0_CUP_HALF_HEIGHT_M, surface.position[2]]
        : surface.position;
      const graspOnTable = Vec.sub(tablePosition, localOffset);
      const actor = next[actorIndex]!;
      const guided = handWorldPose
        ? (frame: number) => handWorldPose(frame, holder.a.part)
        : undefined;
      actor.frames = actor.frames.map((frame) => {
        const guide = guided?.(frame.frame);
        if (guide && frame.frame <= release) {
          const solved = TwoBoneIk.solve(frame.joints, limb, guide.translation);
          const wrist = solved[limb.end];
          if (wrist) wrist.rotation = guide.rotation;
          return { frame: frame.frame, joints: solved };
        }
        if (!place || frame.frame < approachStart || frame.frame > release) return frame;
        const span = Math.max(1, release - approachStart);
        const amount = Math.min(1, Math.max(0, (frame.frame - approachStart) / span));
        const wrist = frame.joints[limb.end]?.translation ?? object.position;
        return { frame: frame.frame, joints: TwoBoneIk.solve(frame.joints, limb, Vec.lerp(wrist, graspOnTable, amount)) };
      });
      const parentId = object.subjectId ?? holder.a.actor_id;
      const handParent = holder.a.actor_id;
      const tableParent = surface.subjectId ?? ContactSolver.surfaceQuery;
      const identity = QuatMath.identity();
      const frames = Array.from({ length: frameCount }, (_, t) => {
        const onTable = Boolean(place) && t >= release;
        if (onTable) return { t, T_world_obj: worldTransform(tablePosition) };
        const wrist = actor.frames.find((item) => item.frame === t)?.joints[limb.end];
        const translation = wrist?.translation ?? object.position;
        const rotation = wrist?.rotation ?? identity;
        return { t, T_world_obj: composeWorldPose(translation, rotation, localOffset) };
      });
      streams.push({ objectId, subjectId: parentId, source: GENERATED_MOTION_SOURCE, frames });
      const holdEnd = Math.min(frameCount, release);
      if (holdEnd > 0) {
        attachments.push({
          objectId,
          parentId: handParent,
          rigPart: holder.a.part,
          sourceContactId: (hold ?? holder).contact_id,
          startFrame: 0,
          endFrame: holdEnd,
          offset: { translation: localOffset, rotation: identity },
        });
      }
      if (place && release < frameCount) {
        attachments.push({
          objectId,
          parentId: tableParent,
          sourceContactId: place.contact_id,
          startFrame: release,
          endFrame: frameCount,
          offset: { translation: [0, 0, 0], rotation: identity },
        });
      }
      for (const contact of related) mark(contact, true);
    }

    return { sequences: next, streams, attachments };
  }

  private static cloneFrame(frame: PoseFrame): PoseFrame {
    return { frame: frame.frame, joints: SmplxSkeleton.clone(frame.joints) };
  }

  private static cloneSequences(sequences: readonly ActorPoseSequence[]): ActorPoseSequence[] {
    return sequences.map((sequence) => ({
      ...sequence,
      frames: sequence.frames.map(ContactSolver.cloneFrame),
    }));
  }
}
