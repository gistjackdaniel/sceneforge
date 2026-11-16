import { interpretScopeEntry } from "../../core/dependency/editScope";
import { computePassHash } from "../../core/dependency/fingerprint";
import { normalizeProductionSelector } from "../../core/dependency/selector";
import type { EditSelector, EditSource } from "./actionGraph";
import type { SolvedContact } from "./contactSolver";
import type { ActorPoseSequence } from "./motionModel";
import type { ObjectAttachment, ObjectPoseStream } from "./objectStream";
import { SmplxSkeleton } from "./pose";

/**
 * One preserve/recompute item.
 * `instanceIds` stays on the selector. Graph `EditScopeInput` keeps that list on the
 * envelope and ignores it for a contact edit, which would drop the per-actor scope.
 */
export type PreserveListEntry = EditSelector & { instanceIds?: readonly string[] };

/**
 * Envelope Graph reads for an edit.
 * `edit_id`, `base_graph_version`, and `source` travel with the two lists.
 * Slice hashes use `computePassHash`.
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
 * Proves an edit's `preserve[]` still matches after the pipeline.
 * Selectors are read with `interpretScopeEntry`. `background` and
 * `contact_constraints` stay on their own slices: the graph normalizer folds
 * `background` into `set_layout` and drops a contact list that has no id.
 * Callers pass the edit envelope (`edit_id`, `base_graph_version`, `source`, both lists).
 */
export class PreserveVerifier {
  static project(scene: Speech2MotionScene, selector: PreserveListEntry): unknown {
    if (!PreserveVerifier.inScope(selector, PreserveVerifier.scopeIds(scene, selector))) return null;
    if (selector.kind === "background") return scene.background;
    if (selector.kind === "contact_constraints") return scene.contacts;
    const interpreted = interpretScopeEntry(selector);
    if ("dependent" in interpreted) return scene.renderPasses;
    if ("query" in interpreted) {
      const query = interpreted.query;
      switch (query.kind) {
        case "camera_track":
          return scene.camera;
        case "set_layout":
          return scene.setLayout;
        case "contact":
          return scene.contacts.find((contact) => contact.contactId === query.contactId) ?? null;
        case "actor":
          return query.motion === "root_motion"
            ? PreserveVerifier.root(scene, query.actorId)
            : PreserveVerifier.motion(scene, query.actorId);
        case "render_pass":
          return scene.renderPasses;
        case "object":
          return null;
        default: {
          const exhaustive: never = query;
          return exhaustive;
        }
      }
    }
    return null;
  }

  static verify(
    before: Speech2MotionScene,
    after: Speech2MotionScene,
    edit: PreserveEditInput,
    hash: (value: unknown) => string = computePassHash,
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
      const normalized = normalizeProductionSelector(selector);
      const contactId = normalized && normalized !== "dependent" && normalized.kind === "contact"
        ? normalized.contactId ?? selector.contact_id
        : selector.contact_id;
      const contact = scene.contacts.find((item) => item.contactId === contactId);
      return [contactId, contact?.a.actorId, contact?.b.actorId, contact?.b.objectId].filter(
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
