export type NodeScope = "clip" | "sequence" | "project";

export type ReferenceType = "shared" | "instance" | "local";

export interface NodeReference {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  scope: NodeScope;
  referenceType: ReferenceType;
  overridePatch?: Record<string, unknown>;
  dependencyRole?: string;
  invalidates?: string[];
}

export const REFERENCE_LABELS: Record<ReferenceType, string> = {
  shared: "Shared",
  instance: "Instance",
  local: "Local",
};

/** Collect node ids linked through NodeReference edges (Reveal References). */
export const collectReferencedNodeIds = (
  nodeId: string,
  references: Record<string, NodeReference>,
  referencesByNodeId: Record<string, string[]>,
): string[] => {
  const related = new Set<string>([nodeId]);

  (referencesByNodeId[nodeId] ?? []).forEach((referenceId) => {
    const reference = references[referenceId];
    if (!reference) {
      return;
    }
    related.add(reference.sourceNodeId);
    related.add(reference.targetNodeId);
  });

  return Array.from(related);
};

/** Legacy persisted values → spec-aligned reference types. */
export const normalizeReferenceType = (value: string): ReferenceType => {
  if (value === "hard_link") {
    return "shared";
  }
  if (value === "copy") {
    return "local";
  }
  if (value === "shared" || value === "instance" || value === "local") {
    return value;
  }
  return "local";
};
