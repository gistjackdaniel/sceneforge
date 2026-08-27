import { describe, expect, it } from "vitest";
import { connectNodes } from "./connectNodes";
import { validateAcyclic } from "./validateAcyclic";
import type { GraphEdge } from "./types";

const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
): GraphEdge => ({
  id,
  sourceNodeId,
  sourcePort: "out",
  targetNodeId,
  targetPort: "in",
  kind: "data",
});

describe("validateAcyclic", () => {
  it("accepts a DAG", () => {
    const result = validateAcyclic([
      edge("e1", "a", "b"),
      edge("e2", "b", "c"),
      edge("e3", "a", "c"),
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects a cycle", () => {
    const result = validateAcyclic([
      edge("e1", "a", "b"),
      edge("e2", "b", "c"),
      edge("e3", "c", "a"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.cyclePath?.length).toBeGreaterThan(0);
  });
});

describe("connectNodes", () => {
  it("blocks self-loops and cycles", () => {
    const existing = [edge("e1", "a", "b")];
    expect(connectNodes(existing, { id: "loop", sourceNodeId: "a", targetNodeId: "a" }).ok).toBe(
      false,
    );
    expect(connectNodes(existing, { id: "back", sourceNodeId: "b", targetNodeId: "a" }).ok).toBe(
      false,
    );
    const ok = connectNodes(existing, { id: "fwd", sourceNodeId: "b", targetNodeId: "c" });
    expect(ok.ok).toBe(true);
    expect(ok.edges).toHaveLength(2);
  });
});
