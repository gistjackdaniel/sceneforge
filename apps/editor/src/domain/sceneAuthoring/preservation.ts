import type { Shot } from "../shot/types";
import { selectedTake } from "../shot/queries";
import { materializeAttachments, resolveContacts } from "./contacts";
import type { InteractionPreviewRecord } from "./contract";
import { SHOT_EULER_ORDER } from "../shot/eulerAdapter";
import { createHandshakePoseSource } from "./fixture";
import { resolvedJointTrack, samplePlayback } from "./playback";
import type { PoseSequenceSource } from "./poseSource";

/**
 * Phase 1 selectors over the shot record.
 *
 * Graph lane owns the shared hash (`core/dependency`). This copy stays here
 * until that export exists. Numbers are quantized to 1e-6 and object keys are sorted.
 * Root motion is the shot pose (`position`, `rotationEuler`, `scale`), not a second clip.
 */
export type PreviewSelector =
  | { kind: "camera_track"; takeId: string }
  | { kind: "actor_root_motion"; subjectId: string }
  | { kind: "actor_motion"; subjectId: string }
  | { kind: "background" }
  | { kind: "contact"; contact_id: string }
  | { kind: "attachment" }
  | { kind: "instance_identity" };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalizeSceneValue = (value: unknown): string =>
  JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === "number") return Math.round(current * 1e6) / 1e6;
    if (isPlainObject(current)) {
      const entries = Object.entries(current).sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(entries);
    }
    return current;
  }) ?? "null";

const byId = <T extends { id: string }>(items: T[]): T[] =>
  items.slice().sort((left, right) => left.id.localeCompare(right.id));

const rootMotion = (shot: Shot, subjectId: string): unknown => {
  const subject = shot.subjects.find((item) => item.id === subjectId);
  if (!subject || subject.kind === "light") return [];
  if (subject.motion.channel === "explicit") {
    return subject.motion.keys.map((key) => ({
      frame: key.frame,
      position: key.position,
      rotationEuler: key.rotationEuler,
      scale: key.scale,
      eulerOrder: SHOT_EULER_ORDER,
    }));
  }
  return [{
    frame: 0,
    position: subject.placement.position,
    rotationEuler: subject.placement.rotationEuler,
    scale: subject.placement.scale,
    eulerOrder: SHOT_EULER_ORDER,
  }];
};

/**
 * Project one selector.
 * Camera, background, and root motion read the shot. Actor motion adds joint samples.
 */
export const projectPreviewState = (
  shot: Shot,
  preview: InteractionPreviewRecord,
  selector: PreviewSelector,
  poses: PoseSequenceSource = createHandshakePoseSource(shot, resolveContacts(preview)),
): unknown => {
  switch (selector.kind) {
    case "camera_track": {
      const take = selectedTake(shot);
      if (!take || take.id !== selector.takeId || shot.camera.status !== "ready") return [];
      return {
        takeId: take.id,
        interpolation: shot.camera.interpolation,
        keys: take.keys.map((key) => ({
          frame: key.frame,
          position: key.position,
          rotation: key.rotation,
          focalLengthMm: key.focalLengthMm,
        })),
      };
    }
    case "actor_root_motion":
      return rootMotion(shot, selector.subjectId);
    case "actor_motion":
      return {
        root: rootMotion(shot, selector.subjectId),
        joints: resolvedJointTrack(shot, selector.subjectId, poses),
      };
    case "background":
      return {
        worldId: shot.environment?.worldId ?? null,
        objects: byId(
          preview.bindings
            .filter((binding) => binding.kind === "set_piece")
            .flatMap((binding) => {
              const subject = shot.subjects.find((item) => item.id === binding.subjectId);
              if (!subject) return [];
              return [{ id: subject.id, worldAssetId: subject.assetId, rest: subject.placement }];
            }),
        ),
      };
    case "contact":
      return resolveContacts(preview).find((contact) => contact.contactId === selector.contact_id) ?? null;
    case "attachment":
      return materializeAttachments(preview);
    case "instance_identity":
      return {
        actors: byId(
          shot.subjects.filter((subject) => subject.kind === "human").map((subject) => ({
            id: subject.id,
            worldAssetId: subject.assetId,
          })),
        ),
        objects: byId(
          shot.subjects.filter((subject) => subject.kind === "object").map((subject) => ({
            id: subject.id,
            worldAssetId: subject.assetId,
          })),
        ),
      };
    default: {
      const neverSelector: never = selector;
      return neverSelector;
    }
  }
};

export const previewStateEqual = (left: unknown, right: unknown): boolean =>
  canonicalizeSceneValue(left) === canonicalizeSceneValue(right);

/** Camera pose the viewport draws at one frame. */
export const cameraPoseAt = (
  shot: Shot,
  preview: InteractionPreviewRecord,
  frame: number,
  poses?: PoseSequenceSource,
): { position: number[]; rotation: number[] } => {
  const source = poses ?? createHandshakePoseSource(shot, resolveContacts(preview));
  const sample = samplePlayback(shot, preview, frame, source).camera;
  return { position: sample.position, rotation: sample.rotation };
};
