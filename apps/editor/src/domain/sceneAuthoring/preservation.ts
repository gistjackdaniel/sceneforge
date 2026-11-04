import type { InteractiveScene } from "./contract";
import { materializeAttachments, resolveContacts, resolvedJointTrack, samplePlayback } from "./playback";

/**
 * Phase 1 selectors for the viewport scene.
 *
 * Graph lane owns the shared hash (`core/dependency`). This copy stays here
 * until that export exists. Do not import it into another lane.
 * Numbers are quantized to 1e-6 and object keys are sorted.
 */
export type PreviewSelector =
  | { kind: "camera_track"; cameraTrackId: string }
  | { kind: "actor_root_motion"; instanceId: string }
  | { kind: "actor_motion"; instanceId: string }
  | { kind: "background" }
  | { kind: "contact"; contactId: string }
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

/**
 * Project one selector onto the resolved scene.
 * Root motion is the stored root samples. Actor motion adds resolved joint rotations.
 * Background is the set WorldAsset plus static / set-piece rests.
 */
export const projectPreviewState = (scene: InteractiveScene, selector: PreviewSelector): unknown => {
  switch (selector.kind) {
    case "camera_track":
      return scene.camera.cameraTrackId === selector.cameraTrackId ? scene.camera.samples : [];
    case "actor_root_motion":
      return scene.poses.find((pose) => pose.instanceId === selector.instanceId)?.root ?? [];
    case "actor_motion": {
      const pose = scene.poses.find((item) => item.instanceId === selector.instanceId);
      return { root: pose?.root ?? [], joints: resolvedJointTrack(scene, selector.instanceId) };
    }
    case "background":
      return {
        worldAssetId: scene.worldAssetId,
        objects: byId(
          scene.objects
            .filter((object) => object.role === "set_piece" || object.motionMode === "static")
            .map((object) => ({
              id: object.instanceId,
              worldAssetId: object.worldAssetId,
              rest: object.rest,
            })),
        ),
      };
    case "contact":
      return resolveContacts(scene).find((contact) => contact.contactId === selector.contactId) ?? null;
    case "attachment":
      return materializeAttachments(scene);
    case "instance_identity":
      return {
        actors: byId(
          scene.subjects.filter((subject) => subject.kind === "actor").map((subject) => ({
            id: subject.instanceId,
            worldAssetId: subject.worldAssetId,
          })),
        ),
        objects: byId(
          scene.subjects.filter((subject) => subject.kind === "object").map((subject) => ({
            id: subject.instanceId,
            worldAssetId: subject.worldAssetId,
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

/** Camera pose the viewport draws. Included so a root-only edit cannot hide a camera change. */
export const cameraPoseAt = (scene: InteractiveScene, frame: number): { position: number[]; rotation: number[] } => {
  const sample = samplePlayback(scene, frame).camera;
  return { position: sample.position, rotation: sample.rotation };
};
