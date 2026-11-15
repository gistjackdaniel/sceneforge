import { hashNormalized, hashString, stableSerialize } from "../../core/dependency/hash";
import type { NodeBase } from "./types";

export { hashString, stableSerialize };
export const hashValue = hashNormalized;

/**
 * Inputs that participate in a node content hash (PRD §11.2).
 * UI position, display name, panel/selection state must not be included.
 */
export interface CacheKeyInput {
  nodeType: string;
  nodeImplementationVersion: string;
  paramsHash: string;
  inputHashes: string[];
  assetVersionHashes: string[];
  renderBackendVersion?: string;
}

const UI_PARAM_KEYS = new Set([
  "ui",
  "displayName",
  "position",
  "panelState",
  "selectionState",
  "temporaryTimestamp",
  "cameraViz",
]);

/** Hash node params while stripping presentation-only keys. */
export const hashNodeParams = (params: Record<string, unknown> | undefined): string => {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (UI_PARAM_KEYS.has(key)) {
      continue;
    }
    filtered[key] = value;
  }
  return hashValue(filtered);
};

export const buildCacheKeyInput = (
  node: Pick<NodeBase, "kind" | "type" | "version" | "parameters" | "params">,
  options?: {
    inputHashes?: string[];
    assetVersionHashes?: string[];
    renderBackendVersion?: string;
  },
): CacheKeyInput => ({
  nodeType: node.kind ?? node.type,
  nodeImplementationVersion: String(node.version),
  paramsHash: hashNodeParams(node.parameters ?? node.params),
  inputHashes: [...(options?.inputHashes ?? [])].sort(),
  assetVersionHashes: [...(options?.assetVersionHashes ?? [])].sort(),
  renderBackendVersion: options?.renderBackendVersion,
});

/**
 * Deterministic content hash. Display name and `node.ui` are intentionally omitted.
 */
export const computeContentHash = (input: CacheKeyInput): string => {
  const payload = [
    input.nodeType,
    input.nodeImplementationVersion,
    input.paramsHash,
    input.inputHashes.join(","),
    input.assetVersionHashes.join(","),
    input.renderBackendVersion ?? "",
  ].join("|");
  return `ck-${hashString(payload)}`;
};

export const computeNodeContentHash = (
  node: Pick<NodeBase, "kind" | "type" | "version" | "parameters" | "params">,
  options?: Parameters<typeof buildCacheKeyInput>[1],
): string => computeContentHash(buildCacheKeyInput(node, options));
