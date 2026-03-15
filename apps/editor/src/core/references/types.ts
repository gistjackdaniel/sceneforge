export type NodeScope = "clip" | "sequence" | "project";

export type ReferenceType = "hard_link" | "instance" | "copy";

export interface NodeReference {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  scope: NodeScope;
  referenceType: ReferenceType;
  overrides?: Record<string, unknown>;
}

export const REFERENCE_LABELS: Record<ReferenceType, string> = {
  hard_link: "Hard Link",
  instance: "Instance",
  copy: "Copy",
};
