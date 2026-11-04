const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Opaque persistent id. Legacy ids (`take-1`, `elem-actor-mark-a`) still match.
 * Callers must not parse meaning out of the string.
 */
export const PERSISTENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

/** New camera tracks use `cam_<ULID>`. Issued ids are never reused. */
export const CAMERA_TRACK_ID_PATTERN = /^cam_[0-9A-HJKMNP-TV-Z]{26}$/;

const encodeTime = (nowMs: number): string => {
  let time = Math.min(Math.max(0, Math.floor(nowMs)), 2 ** 48 - 1);
  const chars = Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[time % 32] ?? "0";
    time = Math.floor(time / 32);
  }
  return chars.join("");
};

const encodeRandom = (): string => {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let bits = 0;
  let value = 0n;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[Number((value >> BigInt(bits)) & 31n)] ?? "0";
    }
  }
  return out;
};

/** 26-character Crockford ULID. Time-ordered and unique without a network. */
export const createUlid = (nowMs = Date.now()): string => `${encodeTime(nowMs)}${encodeRandom()}`;

/**
 * Issue `<prefix>_<ULID>`. The prefix is a namespace, not something callers should parse
 * back out of stored ids. Deleted ids are not returned to the pool.
 */
export const createPersistentId = (prefix: string, nowMs = Date.now()): string => {
  if (!/^[A-Za-z][A-Za-z0-9]{0,16}$/.test(prefix)) {
    throw new Error("Persistent id prefix is invalid.");
  }
  return `${prefix}_${createUlid(nowMs)}`;
};

/** Camera track id. Never reused, including after the take is deleted. */
export const createCameraTrackId = (nowMs = Date.now()): string => createPersistentId("cam", nowMs);

export const isPersistentId = (value: string): boolean => PERSISTENT_ID_PATTERN.test(value);
