import type { EditSelector, EditSource } from "./actionGraph";
import type { SolvedContact } from "./contactSolver";
import type { ActorPoseSequence } from "./motionModel";
import { hashNormalized } from "./normalizedHash";
import type { ObjectAttachment, ObjectPoseStream } from "./objectStream";
import { SmplxSkeleton } from "./pose";

/**
 * One preserve/recompute item.
 *
 * TODO(#32 머지 후 교체): Graph reads `contact_id` and `instanceIds: string[]`
 * from each list item. This intersection keeps those fields on the action-graph
 * selector without editing `actionGraph.ts`.
 */
export type PreserveListEntry = EditSelector & { instanceIds?: readonly string[] };

/**
 * Envelope Graph PR #32 now takes for an edit.
 * `edit_id`, `base_graph_version`, and `source` travel with the two lists.
 *
 * TODO(#32 머지 후 교체): pass this object to `core/dependency` instead of hashing locally.
 */
export interface PreserveEditInput {
  edit_id: string;
  base_graph_version: string;
  source: Pick<EditSource, "type"> & { transcript?: string };
  preserve: readonly PreserveListEntry[];
  recompute: readonly PreserveListEntry[];
}

/**
 * Values the preserve check compares. Camera, background, and set layout are copies of the shot.
 * Actor curves are the model output after contact IK.
 */
export interface Speech2MotionScene {
  shotId: string;
  fps: number;
  frameCount: number;
  camera: unknown;
  background: unknown;
  setLayout: unknown;
  renderPasses: unknown;
  actors: readonly ActorPoseSequence[];
  objects: readonly ObjectPoseStream[];
  attachments: readonly ObjectAttachment[];
  contacts: readonly SolvedContact[];
}

export interface PreserveRow {
  selector: PreserveListEntry;
  ok: boolean;
  beforeHash: string;
  afterHash: string;
}

/**
 * Proves an edit's `preserve[]` still matches after the pipeline, using a normalized hash.
 * The hasher is the Graph lane stand-in until `core/dependency` exports `hashNormalized`.
 * Callers pass the edit envelope (`edit_id`, `base_graph_version`, `source`, both lists).
 */
export class PreserveVerifier {
  static project(scene: Speech2MotionScene, selector: PreserveListEntry): unknown {
    if (!PreserveVerifier.inScope(selector, PreserveVerifier.scopeIds(scene, selector))) return null;
    switch (selector.kind) {
      case "camera_track":
        return scene.camera;
      case "background":
        return scene.background;
      case "set_layout":
        return scene.setLayout;
      case "render_passes":
        return scene.renderPasses;
      case "contact_constraints":
        return scene.contacts;
      case "contact":
        return scene.contacts.find((contact) => contact.contactId === selector.contact_id) ?? null;
      case "root_motion":
        return PreserveVerifier.root(scene, selector.actor_id);
      case "motion":
        return PreserveVerifier.motion(scene, selector.actor_id);
      default: {
        const neverSelector: never = selector;
        return neverSelector;
      }
    }
  }

  static verify(
    before: Speech2MotionScene,
    after: Speech2MotionScene,
    edit: PreserveEditInput,
    hash: (value: unknown) => string = hashNormalized,
  ): { ok: boolean; rows: PreserveRow[] } {
    const rows = edit.preserve.map((selector) => {
      const beforeHash = hash(PreserveVerifier.project(before, selector));
      const afterHash = hash(PreserveVerifier.project(after, selector));
      return { selector, ok: beforeHash === afterHash, beforeHash, afterHash };
    });
    return { ok: rows.every((row) => row.ok), rows };
  }

  /** `instanceIds` narrows the unit. An omitted list keeps the whole selector. */
  private static inScope(selector: PreserveListEntry, ids: readonly string[]): boolean {
    if (!selector.instanceIds || selector.instanceIds.length === 0) return true;
    const wanted = new Set(selector.instanceIds);
    return ids.some((id) => wanted.has(id));
  }

  private static scopeIds(scene: Speech2MotionScene, selector: PreserveListEntry): string[] {
    if (selector.kind === "camera_track") {
      const track = scene.camera as { cameraTrackId?: string | null };
      return track.cameraTrackId ? [track.cameraTrackId] : [];
    }
    if (selector.kind === "contact") {
      const contact = scene.contacts.find((item) => item.contactId === selector.contact_id);
      return [selector.contact_id, contact?.a.actorId, contact?.b.actorId, contact?.b.objectId].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
    }
    if (selector.kind === "motion" || selector.kind === "root_motion") {
      return selector.actor_id ? [selector.actor_id] : [];
    }
    if (selector.kind === "contact_constraints") {
      return scene.contacts.map((contact) => contact.contactId);
    }
    return [];
  }

  private static motion(scene: Speech2MotionScene, actorId: string | undefined): unknown {
    if (!actorId) return null;
    const sequence = scene.actors.find((actor) => actor.actorId === actorId);
    return sequence?.frames ?? null;
  }

  private static root(scene: Speech2MotionScene, actorId: string | undefined): unknown {
    if (!actorId) return null;
    const sequence = scene.actors.find((actor) => actor.actorId === actorId);
    if (!sequence) return null;
    return sequence.frames.map((frame) => {
      const pelvis = frame.joints[SmplxSkeleton.pelvisIndex];
      return {
        frame: frame.frame,
        translation: pelvis?.translation ?? null,
        rotation: pelvis?.rotation ?? null,
      };
    });
  }
}
