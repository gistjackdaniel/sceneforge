/**
 * Speech2motion preserve hashes go through the graph dependency pass hash.
 * `computePassHash` is `hashNormalized` from `core/dependency/hash.ts`:
 * sorted object keys, stable array order, then the shared string hash.
 */
export { computePassHash } from "../../core/dependency/fingerprint";
export { hashNormalized, hashString, stableSerialize } from "../../core/dependency/hash";
export { interpretScopeEntry } from "../../core/dependency/editScope";
export { normalizeProductionSelector } from "../../core/dependency/selector";
