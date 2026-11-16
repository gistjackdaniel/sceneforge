import type { CameraTakeLegacyRef } from "../../domain/shot/types";
import type { LegacyRef } from "../../domain/worlds/sceneState";

/**
 * Legacy id → current id.
 *
 * `legacyRefs` is the World/Scene `LegacyRef`, or a camera take ref
 * `{ kind: "camera_take", shotId, takeId }` (`CameraTakeLegacyRef`).
 * `takeId` is the previous id. `shotId` is not a cache id.
 * Other previous ids are `shot_subject.subjectId`, `world_element.elementId`,
 * `scene_object.sceneObjectId`, and `shot_asset.assetId`. A prop name is not an id.
 */

type LegacyRefInput = LegacyRef | CameraTakeLegacyRef;

export interface LegacyRefCarrier {
  id: string;
  legacyRefs?: readonly LegacyRefInput[];
}

export interface LegacyIdResolver {
  /** Previous id to the id that replaced it. Unknown ids return undefined. */
  resolveLegacyId(id: string): string | undefined;
  legacyIds(currentId: string): readonly string[];
}

const idList = (value: string): string[] => (value.length > 0 ? [value] : []);

const readLegacyIds = (ref: LegacyRefInput): string[] => {
  switch (ref.kind) {
    case "shot_subject":
      return idList(ref.subjectId);
    case "world_element":
      return idList(ref.elementId);
    case "scene_object":
      return idList(ref.sceneObjectId);
    case "shot_asset":
      return idList(ref.assetId);
    case "camera_take":
      return idList(ref.takeId);
    case "world_prop_name":
      return [];
    default: {
      const _exhaustive: never = ref;
      void _exhaustive;
      return [];
    }
  }
};

/** Build a resolver from records that already carry `legacyRefs`. */
export const createLegacyIdResolver = (carriers: readonly LegacyRefCarrier[]): LegacyIdResolver => {
  const currentByLegacy = new Map<string, string>();
  const legacyByCurrent = new Map<string, string[]>();
  carriers.forEach((carrier) => {
    (carrier.legacyRefs ?? []).forEach((ref) => {
      readLegacyIds(ref).forEach((legacyId) => {
        if (legacyId === carrier.id || currentByLegacy.has(legacyId)) {
          return;
        }
        currentByLegacy.set(legacyId, carrier.id);
        const list = legacyByCurrent.get(carrier.id) ?? [];
        list.push(legacyId);
        legacyByCurrent.set(carrier.id, list);
      });
    });
  });
  return {
    resolveLegacyId(id) {
      return currentByLegacy.get(id);
    },
    legacyIds(currentId) {
      return legacyByCurrent.get(currentId) ?? [];
    },
  };
};

export const resolveLegacyId = (id: string, carriers: readonly LegacyRefCarrier[]): string | undefined =>
  createLegacyIdResolver(carriers).resolveLegacyId(id);
