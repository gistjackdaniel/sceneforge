import { createPersistentIdFactory, ID_PREFIX, sanitizeLegacyToken } from "../worlds/ids";
import type { CameraTakeLegacyRef, ShotCamera } from "./types";

/** Fresh camera takes. Issued ids are never reused. */
export const CAMERA_TAKE_ID_PATTERN = /^cam_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Deterministic id for a legacy `take-${shotId}-${index}` (or any pre-ULID take id).
 * Same shot id and previous take id always return the same string. This is not a minted ULID.
 * The shape matches World's `act_legacy_${world}__${element}` migration.
 */
export const legacyCameraTakeId = (shotId: string, previousTakeId: string): string =>
  `cam_legacy_${sanitizeLegacyToken(shotId)}__${sanitizeLegacyToken(previousTakeId)}`;

const isMigratedId = (id: string): boolean =>
  CAMERA_TAKE_ID_PATTERN.test(id) || id.startsWith("cam_legacy_");

/** Ids that must not be minted again: live takes, retired takes, and the legacy ids they replaced. */
export const reservedCameraTakeIds = (camera: ShotCamera): string[] => {
  const ids: string[] = [...camera.retiredTakeIds];
  if (camera.status !== "ready") return ids;
  for (const take of camera.takes) {
    ids.push(take.id);
    for (const ref of take.legacyRefs) ids.push(ref.takeId);
  }
  return ids;
};

/** Mint `cam_<ULID>` and keep it out of `reserved`. */
export const mintCameraTakeId = (reserved: Iterable<string>, now = Date.now()): string => {
  const factory = createPersistentIdFactory({ now: () => now, reserved });
  return factory.mint(ID_PREFIX.cameraTrack);
};

/**
 * Rewrite pre-ULID take ids in place order. Re-running this on the result is a no-op.
 * The previous id is appended to `legacyRefs` and is not reused as a live id.
 */
export const migrateCameraTakeIds = <T extends { id: string; legacyRefs: readonly CameraTakeLegacyRef[] }>(
  shotId: string,
  takes: readonly T[],
  selectedId: string,
): { takes: T[]; selectedId: string } => {
  const used = new Set<string>();
  const nextTakes = takes.map((take) => {
    if (isMigratedId(take.id)) {
      used.add(take.id);
      return take;
    }
    const previous = take.id;
    let id = legacyCameraTakeId(shotId, previous);
    if (used.has(id)) {
      let occurrence = 2;
      while (used.has(`${id}_${occurrence}`)) occurrence += 1;
      id = `${id}_${occurrence}`;
    }
    used.add(id);
    const already = take.legacyRefs.some(
      (ref) => ref.kind === "camera_take" && ref.shotId === shotId && ref.takeId === previous,
    );
    const legacyRefs: CameraTakeLegacyRef[] = already
      ? [...take.legacyRefs]
      : [...take.legacyRefs, { kind: "camera_take", shotId, takeId: previous }];
    return { ...take, id: id as T["id"], legacyRefs };
  });
  const selectedIndex = takes.findIndex((take) => take.id === selectedId);
  return {
    takes: nextTakes,
    selectedId: selectedIndex >= 0 ? nextTakes[selectedIndex].id : selectedId,
  };
};
