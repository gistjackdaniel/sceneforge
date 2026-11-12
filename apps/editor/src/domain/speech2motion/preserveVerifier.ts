import type { EditSelector } from "./actionGraph";
import type { SolvedContact } from "./contactSolver";
import type { ActorPoseSequence } from "./motionModel";
import { hashNormalized } from "./normalizedHash";
import type { ObjectAttachment, ObjectPoseStream } from "./objectStream";
import { SmplxSkeleton } from "./pose";

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
  selector: EditSelector;
  ok: boolean;
  beforeHash: string;
  afterHash: string;
}

/**
 * Proves an edit's `preserve[]` still matches after the pipeline, using a normalized hash.
 * The hasher is the Graph lane stand-in until `core/dependency` exports `hashNormalized`.
 */
export class PreserveVerifier {
  static project(scene: Speech2MotionScene, selector: EditSelector): unknown {
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
    preserve: readonly EditSelector[],
    hash: (value: unknown) => string = hashNormalized,
  ): { ok: boolean; rows: PreserveRow[] } {
    const rows = preserve.map((selector) => {
      const beforeHash = hash(PreserveVerifier.project(before, selector));
      const afterHash = hash(PreserveVerifier.project(after, selector));
      return { selector, ok: beforeHash === afterHash, beforeHash, afterHash };
    });
    return { ok: rows.every((row) => row.ok), rows };
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
