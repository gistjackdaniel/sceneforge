/**
 * Legacy id → current id.
 *
 * World and Scene lanes keep the previous id on `legacyRefs`. Those modules are
 * not imported here. A camera take ref is `{ kind: "camera_take", shotId, takeId }`
 * on the take, after `mapping`. `takeId` is the previous id. `shotId` is not a cache id.
 * Other refs contribute `subjectId`, `elementId`, `sceneObjectId`, or `shot_asset.assetId`.
 */

export interface LegacyRefCarrier {
  id: string;
  legacyRefs?: readonly unknown[];
}

export interface LegacyIdResolver {
  /** Previous id to the id that replaced it. Unknown ids return undefined. */
  resolveLegacyId(id: string): string | undefined;
  legacyIds(currentId: string): readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

const LEGACY_ID_FIELDS = ["subjectId", "elementId", "sceneObjectId", "legacyId"] as const;

const readLegacyIds = (ref: unknown): string[] => {
  if (!isRecord(ref)) {
    return [];
  }
  const ids = LEGACY_ID_FIELDS.flatMap((field) => {
    const value = text(ref[field]);
    return value ? [value] : [];
  });
  if (ref.kind === "camera_take") {
    const takeId = text(ref.takeId);
    if (takeId) {
      ids.push(takeId);
    }
  }
  if (ref.kind === "shot_asset") {
    const assetId = text(ref.assetId);
    if (assetId) {
      ids.push(assetId);
    }
  }
  return ids;
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
