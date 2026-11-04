const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Opaque id. Legacy ids (`clip-001`, `elem-actor-mark-a`) stay valid. Meaning is not parsed from the string. */
export const PERSISTENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_\-]{0,127}$/;

export const isPersistentId = (value: string): boolean => PERSISTENT_ID_PATTERN.test(value);

const encodeTime = (now: number, length: number): string => {
  let time = now;
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded = CROCKFORD[time % 32] + encoded;
    time = Math.floor(time / 32);
  }
  return encoded;
};

const encodeRandom = (length: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded += CROCKFORD[bytes[index] & 31];
  }
  return encoded;
};

/** 26-char ULID (10 time + 16 random). No extra dependency. */
export const createUlid = (now = Date.now()): string => `${encodeTime(now, 10)}${encodeRandom(16)}`;

/**
 * New persistent id `<prefix>_<ULID>`.
 * Prefixes used by the timeline lane: `sht` (shot), `sev` (shot edit), `shr` (shot revision).
 * Side effect: reads the clock and CSPRNG. Does not touch project state.
 */
export const createPersistentId = (prefix: string, now = Date.now()): string => {
  const id = `${prefix}_${createUlid(now)}`;
  if (!isPersistentId(id)) {
    throw new Error(`Could not allocate an id for prefix ${prefix}.`);
  }
  return id;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Deterministic shot id for clips that predate the Shot document.
 * Re-running migration yields the same id. The hash disambiguates sanitized collisions.
 */
export const legacyShotId = (clipId: string): string => {
  const sanitized = clipId.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "");
  const body = (sanitized.length > 0 ? sanitized : "clip").slice(0, 96);
  const id = `sht_legacy_${body}_${stableHash(clipId)}`;
  return id.slice(0, 128);
};

/** Deterministic first revision for a shot created by migration. */
export const legacyShotRevisionId = (shotId: string): string => `shr_legacy_${stableHash(`rev:${shotId}`)}`;
