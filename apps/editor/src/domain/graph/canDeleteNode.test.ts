import { describe, expect, it } from "vitest";
import { canDeleteNode, nodesRemovableWithClip } from "./canDeleteNode";
import { defaultPorts, type NodeBase } from "./types";
import type { NodeReference } from "./references";

const ports = defaultPorts();

const node = (
  id: string,
  referenceType: NodeBase["referenceType"],
  scope: NodeBase["scope"] = "clip",
): NodeBase => ({
  id,
  name: id,
  kind: "PlacementNode",
  type: "PlacementNode",
  category: "scene",
  scope,
  enabled: true,
  tags: [],
  version: 1,
  referenceType,
  parameters: {},
  params: {},
  downstreamNodeIds: [],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("canDeleteNode", () => {
  it("allows deleting an unreferenced local node", () => {
    const nodes = { a: node("a", "local") };
    const result = canDeleteNode("a", nodes, {}, {});
    expect(result.allowed).toBe(true);
  });

  it("rejects deleting a node targeted by another reference", () => {
    const nodes = { a: node("a", "shared"), b: node("b", "local") };
    const references: Record<string, NodeReference> = {
      r1: {
        id: "r1",
        sourceNodeId: "b",
        targetNodeId: "a",
        scope: "project",
        referenceType: "shared",
      },
    };
    const result = canDeleteNode("a", nodes, references, { a: ["clip-1"], b: ["clip-2"] });
    expect(result.allowed).toBe(false);
    expect(result.references.length).toBeGreaterThan(0);
  });
});

describe("nodesRemovableWithClip", () => {
  it("keeps shared nodes when deleting a clip", () => {
    const nodes = {
      local: node("local", "local"),
      shared: node("shared", "shared", "project"),
    };
    const removable = nodesRemovableWithClip(
      ["local", "shared"],
      nodes,
      { local: ["clip-1"], shared: ["clip-1", "clip-2"] },
      "clip-1",
    );
    expect(removable).toEqual(["local"]);
  });
});
