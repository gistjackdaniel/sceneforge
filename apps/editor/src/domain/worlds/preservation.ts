import type { SceneState } from "./sceneState";

/**
 * Preserve / recompute selector grammar for the Phase 1 scene check.
 *
 * Replacement point: the Graph lane will publish this union and the hash
 * normalization from `apps/editor/src/core/dependency`. Until that export
 * exists, call sites should depend on {@link PreservationCheck} and pass
 * `temporaryPreservationCheck`. Delete `temporaryCanonicalize` and
 * `temporaryPreservationHasher` in that change. Do not copy them into another lane.
 */
export type StateSelector =
  | { kind: "camera_track"; cameraTrackId: string }
  | { kind: "actor_root_motion"; actorId: string }
  | { kind: "actor_motion"; actorId: string }
  | { kind: "set_layout" }
  | { kind: "contact"; contactId: string }
  | { kind: "instance_identity" };

/**
 * Read port for data this lane does not own.
 * Camera samples and actor poses belong to Scene and Video. Contact records
 * belong to the contact graph. World only reads them to prove an edit's scope.
 */
export interface ShotStateReader {
  scene: SceneState;
  cameraSamples(cameraTrackId: string): unknown[];
  actorPoseFrames(actorId: string): Array<{
    t: number;
    transl: number[];
    global_orient: number[];
    [extra: string]: unknown;
  }>;
  contact(contactId: string): unknown;
}

/** Graph lane's future hash function. Equal hashes mean the normalized value matched. */
export interface PreservationHasher {
  hash(value: unknown): string;
}

export interface PreservationReportRow {
  selector: StateSelector;
  expect: "preserved" | "changed";
  ok: boolean;
}

export type PreservationReport = PreservationReportRow[];

export interface PreservationCheck {
  /**
   * Compare two shot readings.
   * `instance_identity` is always preserved, even when the caller omits it.
   * No I/O. Does not modify the readers.
   */
  check(
    before: ShotStateReader,
    after: ShotStateReader,
    preserve: readonly StateSelector[],
    recompute: readonly StateSelector[],
  ): PreservationReport;
}

/**
 * Temporary normalization: sorted object keys and numbers quantized to 1e-6.
 * This is not SHA-256. Graph lane replaces it with the shared pass hash.
 */
export const temporaryCanonicalize = (value: unknown): string =>
  JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === "number") return Math.round(current * 1e6) / 1e6;
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const entries = Object.entries(current as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      return Object.fromEntries(entries);
    }
    return current;
  }) ?? "null";

export const temporaryPreservationHasher: PreservationHasher = {
  hash(value) {
    return temporaryCanonicalize(value);
  },
};

const selectorKey = (selector: StateSelector): string => {
  switch (selector.kind) {
    case "camera_track":
      return `camera_track:${selector.cameraTrackId}`;
    case "actor_root_motion":
      return `actor_root_motion:${selector.actorId}`;
    case "actor_motion":
      return `actor_motion:${selector.actorId}`;
    case "set_layout":
      return "set_layout";
    case "contact":
      return `contact:${selector.contactId}`;
    case "instance_identity":
      return "instance_identity";
    default: {
      const neverSelector: never = selector;
      return neverSelector;
    }
  }
};

const byId = <T extends { id: string }>(items: T[]): T[] =>
  items.slice().sort((left, right) => left.id.localeCompare(right.id));

/** Project a selector onto the values the Phase 1 check compares. Lists are sorted by id. */
export const projectSceneSelector = (reader: ShotStateReader, selector: StateSelector): unknown => {
  switch (selector.kind) {
    case "camera_track":
      return reader.cameraSamples(selector.cameraTrackId);
    case "actor_root_motion":
      return reader.actorPoseFrames(selector.actorId).map(({ t, transl, global_orient }) => ({
        t,
        transl,
        global_orient,
      }));
    case "actor_motion":
      return reader.actorPoseFrames(selector.actorId);
    case "set_layout":
      return {
        set: reader.scene.setAssetRef,
        objects: byId(
          Object.values(reader.scene.objects).filter(
            (object) => object.role === "set_piece" || object.motionMode === "static",
          ),
        ).map((object) => ({ id: object.id, assetRef: object.assetRef, rest: object.restTransform })),
      };
    case "contact":
      return reader.contact(selector.contactId);
    case "instance_identity":
      return {
        actors: byId(Object.values(reader.scene.actors)).map((actor) => ({
          id: actor.id,
          assetRef: actor.assetRef,
          deleted: Boolean(actor.deletedAt),
        })),
        objects: byId(Object.values(reader.scene.objects)).map((object) => ({
          id: object.id,
          assetRef: object.assetRef,
          deleted: Boolean(object.deletedAt),
        })),
      };
    default: {
      const neverSelector: never = selector;
      return neverSelector;
    }
  }
};

export const createPreservationCheck = (hasher: PreservationHasher): PreservationCheck => ({
  check(before, after, preserve, recompute) {
    const preserved = new Map<string, StateSelector>();
    for (const selector of [...preserve, { kind: "instance_identity" } as const]) {
      preserved.set(selectorKey(selector), selector);
    }
    const rows: PreservationReport = [];
    for (const selector of preserved.values()) {
      const same = hasher.hash(projectSceneSelector(before, selector)) === hasher.hash(projectSceneSelector(after, selector));
      rows.push({ selector, expect: "preserved", ok: same });
    }
    for (const selector of recompute) {
      const changed =
        hasher.hash(projectSceneSelector(before, selector)) !== hasher.hash(projectSceneSelector(after, selector));
      rows.push({ selector, expect: "changed", ok: changed });
    }
    return rows;
  },
});

/** Local stand-in. Swap this binding for the Graph lane export when it lands. */
export const temporaryPreservationCheck = createPreservationCheck(temporaryPreservationHasher);
