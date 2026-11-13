import { z } from "zod";
import { WorldDomainError } from "./errors";

/**
 * Persistent id prefixes. The body is an opaque sortable token.
 * `mintSortableBody` is the only ULID-specific function; replace it, and
 * `NEW_ID_BODY`, when ids move to UUIDv7.
 */
export const ID_PREFIX = {
  asset: "ast",
  revision: "rev",
  actor: "act",
  object: "obj",
  cameraTrack: "cam",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Crockford base32 body. Not a UUID. Swap this pattern together with `mintSortableBody`. */
const NEW_ID_BODY_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";
export const NEW_ID_BODY = new RegExp(`^${NEW_ID_BODY_PATTERN}$`);

/**
 * Opaque persistent id. Legacy ids (`world-apartment-livingroom`, `elem-actor-mark-a`,
 * `asset-${worldId}`) stay valid. Callers must not parse meaning out of the string.
 */
export const persistentIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_\-]{0,127}$/, "persistent id is not opaque-safe");

export const newIdSchema = (prefix: IdPrefix) =>
  z.string().regex(new RegExp(`^${prefix}_${NEW_ID_BODY_PATTERN}$`), `${prefix}_<ULID> id required`);

export type RandomBytes = (length: number) => Uint8Array;

export interface PersistentIdFactory {
  /** Mint `<prefix>_<sortable body>` and reserve it. Tombstoned ids passed to `reserve` cannot come back. */
  mint(prefix: IdPrefix): string;
  /** Remember an existing id so a later mint cannot return it. */
  reserve(id: string): void;
}

const encodeTime = (time: number): string => {
  if (!Number.isSafeInteger(time) || time < 0 || time >= 2 ** 48) {
    throw new WorldDomainError("ulid_time", "Persistent id time is out of range.");
  }
  let value = time;
  const chars = Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[value % 32] ?? "0";
    value = Math.floor(value / 32);
  }
  return chars.join("");
};

const encodeRandom = (bytes: Uint8Array): string => {
  if (bytes.length !== 10) {
    throw new WorldDomainError("ulid_random", "Persistent id randomness must be 10 bytes.");
  }
  let accumulator = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    accumulator = accumulator * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const index = Math.floor(accumulator / 2 ** bits) % 32;
      out += CROCKFORD[index] ?? "0";
      accumulator %= 2 ** bits;
    }
  }
  return out;
};

/**
 * 48-bit time plus 80-bit randomness, Crockford-encoded to 26 characters.
 * This is the single ULID implementation. A UUIDv7 body replaces this function only.
 */
const mintSortableBody = (time: number, random: Uint8Array): string =>
  `${encodeTime(time)}${encodeRandom(random)}`;

const incrementBytes = (bytes: Uint8Array): Uint8Array => {
  const next = new Uint8Array(bytes);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const current = next[index] ?? 0;
    if (current < 255) {
      next[index] = current + 1;
      return next;
    }
    next[index] = 0;
  }
  throw new WorldDomainError("ulid_exhausted", "Persistent id randomness overflowed.");
};

const cryptoRandom: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new WorldDomainError("ulid_entropy", "crypto.getRandomValues is unavailable.");
  }
  cryptoApi.getRandomValues(bytes);
  return bytes;
};

/**
 * Create the process-local id factory.
 * Same-millisecond mints increment the previous body so lexical order matches creation order.
 * Reserved ids, including tombstones, are never returned.
 */
export const createPersistentIdFactory = (options?: {
  now?: () => number;
  randomBytes?: RandomBytes;
  reserved?: Iterable<string>;
}): PersistentIdFactory => {
  const now = options?.now ?? (() => Date.now());
  const randomBytes = options?.randomBytes ?? cryptoRandom;
  const reserved = new Set(options?.reserved ?? []);
  let lastTime = -1;
  let lastRandom: Uint8Array | undefined;

  return {
    reserve(id) {
      reserved.add(id);
    },
    mint(prefix) {
      let time = now();
      if (!Number.isSafeInteger(time) || time < 0) {
        throw new WorldDomainError("ulid_time", "Persistent id clock is invalid.");
      }
      let random: Uint8Array;
      if (lastRandom && time <= lastTime) {
        time = lastTime;
        random = incrementBytes(lastRandom);
      } else {
        random = randomBytes(10);
      }
      for (let attempt = 0; attempt < 1024; attempt += 1) {
        const id = `${prefix}_${mintSortableBody(time, random)}`;
        if (!reserved.has(id)) {
          reserved.add(id);
          lastTime = time;
          lastRandom = random;
          return id;
        }
        random = incrementBytes(random);
      }
      throw new WorldDomainError("id_exhausted", "Could not mint a fresh persistent id.");
    },
  };
};

/** Replace characters that legacy world and element ids use so a derived id stays persistent-id safe. */
export const sanitizeLegacyToken = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * Deterministic actor id for a legacy `actor_mark`.
 * Re-running the migration returns the same id. This is not a minted ULID.
 */
export const legacyActorInstanceId = (worldId: string, elementId: string): string =>
  `act_legacy_${sanitizeLegacyToken(worldId)}__${sanitizeLegacyToken(elementId)}`;

/**
 * Deterministic object id for a legacy `socket` element.
 * Distinct from prop-name ids so a socket and a prop can share a display name.
 */
export const legacyElementObjectInstanceId = (worldId: string, elementId: string): string =>
  `obj_legacy_${sanitizeLegacyToken(worldId)}__${sanitizeLegacyToken(elementId)}`;

/**
 * Deterministic object id for `WorldAsset.props` names.
 * The first occurrence has no suffix. Later occurrences that sanitize to the same token
 * get `_2`, `_3`, … so the migration stays idempotent and ids are not reused.
 */
export const legacyPropInstanceId = (worldId: string, propName: string, occurrence: number): string => {
  const base = `obj_legacy_${sanitizeLegacyToken(worldId)}__prop_${sanitizeLegacyToken(propName)}`;
  return occurrence <= 1 ? base : `${base}_${occurrence}`;
};

export const legacyWorldAssetId = (worldId: string): string => `asset-${worldId}`;

export const legacyRevisionId = (worldId: string, revision: number): string =>
  `rev_legacy_${sanitizeLegacyToken(worldId)}__v${revision}`;

export const reserveSceneIds = (
  factory: PersistentIdFactory,
  ids: Iterable<string>,
): void => {
  for (const id of ids) factory.reserve(id);
};
