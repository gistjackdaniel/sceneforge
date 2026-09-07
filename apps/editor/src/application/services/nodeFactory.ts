import { defaultPorts, type NodeBase, type NodeCategory, type NodeKind } from "../../domain/graph/types";
import type { NodeReference } from "../../domain/graph/references";

export const createNodeBase = (input: {
  id: string;
  name: string;
  kind: NodeKind;
  category: NodeCategory;
  parameters: Record<string, unknown>;
  timestamp: string;
  referenceType?: NodeReference["referenceType"];
  scope?: NodeBase["scope"];
  downstreamNodeIds?: string[];
}): NodeBase => {
  const ports = defaultPorts();
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    type: input.kind,
    category: input.category,
    scope: input.scope ?? "clip",
    enabled: true,
    tags: [],
    version: 1,
    referenceType: input.referenceType ?? "local",
    parameters: input.parameters,
    params: input.parameters,
    downstreamNodeIds: input.downstreamNodeIds ?? [],
    status: "clean",
    inputPorts: ports.inputPorts,
    outputPorts: ports.outputPorts,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
};
