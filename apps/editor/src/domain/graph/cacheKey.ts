import type { NodeBase } from "./types";

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

export const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`).join(",")}}`;
};

export const hashString = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const hashValue = (value: unknown): string => hashString(stableSerialize(value));

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
