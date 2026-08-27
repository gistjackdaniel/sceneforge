import type { NodeBase } from "./types";
import type { NodeReference } from "./references";

export interface ReferenceOpResult {
  nodes: Record<string, NodeBase>;
  references: Record<string, NodeReference>;
}

/** Break a reference into an independent local copy (no cascade delete). */
export const breakLink = (
  nodes: Record<string, NodeBase>,
  references: Record<string, NodeReference>,
  referenceId: string,
  timestamp: string,
): ReferenceOpResult => {
  const reference = references[referenceId];
  if (!reference) {
    return { nodes, references };
  }
  const target = nodes[reference.targetNodeId];
  const nextNodes = target
    ? {
        ...nodes,
        [target.id]: { ...target, referenceType: "local" as const, updatedAt: timestamp },
      }
    : nodes;
  const { [referenceId]: _removed, ...rest } = references;
  return { nodes: nextNodes, references: rest };
};

/** Convert a node to local and drop all of its references. */
export const makeLocal = (
  nodes: Record<string, NodeBase>,
  references: Record<string, NodeReference>,
  nodeId: string,
  timestamp: string,
): ReferenceOpResult => {
  const node = nodes[nodeId];
  if (!node) {
    return { nodes, references };
  }
  const nextReferences = Object.fromEntries(
    Object.entries(references).filter(
      ([, reference]) => reference.sourceNodeId !== nodeId && reference.targetNodeId !== nodeId,
    ),
  );
  return {
    nodes: {
      ...nodes,
      [nodeId]: { ...node, referenceType: "local", updatedAt: timestamp },
    },
    references: nextReferences,
  };
};

/** Instance-level override patch. Does not clone the shared source node. */
export const overrideValue = (
  nodes: Record<string, NodeBase>,
  references: Record<string, NodeReference>,
  referenceId: string,
  patch: Record<string, unknown>,
  timestamp: string,
): ReferenceOpResult => {
  const reference = references[referenceId];
  if (!reference) {
    return { nodes, references };
  }
  const target = nodes[reference.targetNodeId];
  const nextPatch = { ...(reference.overridePatch ?? {}), ...patch };
  return {
    references: {
      ...references,
      [referenceId]: { ...reference, overridePatch: nextPatch, referenceType: "instance" },
    },
    nodes: target
      ? {
          ...nodes,
          [target.id]: {
            ...target,
            referenceType: "instance",
            parameters: { ...target.parameters, ...patch },
            params: { ...(target.params ?? target.parameters), ...patch },
            updatedAt: timestamp,
          },
        }
      : nodes,
  };
};
