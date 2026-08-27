import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "./types";
import { createDependencyService } from "./dependencyService";
import { breakLink, makeLocal, overrideValue } from "./referenceOps";
import type { NodeReference } from "./references";
import type { DependencyMap } from "../project/clipGraph";

const ports = defaultPorts();

const node = (id: string, extras: Partial<NodeBase> = {}): NodeBase => ({
  id,
  name: id,
  kind: extras.kind ?? "LightingRigNode",
  type: extras.kind ?? "LightingRigNode",
  category: "cinematic",
  scope: "project",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: extras.referenceType ?? "shared",
  parameters: extras.parameters ?? { intensity: 1 },
  params: extras.parameters ?? { intensity: 1 },
  downstreamNodeIds: extras.downstreamNodeIds ?? [],
  status: "clean",
  inputPorts: ports.inputPorts,
  outputPorts: ports.outputPorts,
  createdAt: "t0",
  updatedAt: "t0",
});

describe("DependencyService", () => {
  const nodes = {
    light: node("light", { downstreamNodeIds: ["render"] }),
    render: node("render", { kind: "RenderSettingsNode" }),
  };
  const references: Record<string, NodeReference> = {
    r1: {
      id: "r1",
      sourceNodeId: "light",
      targetNodeId: "instance",
      scope: "project",
      referenceType: "instance",
    },
  };
  const dependencyMap: DependencyMap = {
    downstreamByNodeId: { light: ["render"], render: [] },
    clipsByNodeId: { light: ["clip-a"], render: ["clip-a"] },
    referencesByNodeId: { light: ["r1"] },
    cacheHashesByClipId: {},
  };
  const service = createDependencyService({
    nodes: { ...nodes, instance: node("instance", { referenceType: "instance" }) },
    references,
    clipGraphs: {
      g1: {
        id: "g1",
        clipId: "clip-a",
        rootNodeId: "render",
        nodeIds: ["light", "render"],
        edges: [
          {
            id: "e1",
            sourceNodeId: "light",
            sourcePort: "out",
            targetNodeId: "render",
            targetPort: "in",
            kind: "data",
          },
        ],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    dependencyMap,
  });

  it("walks downstream from edges and node indexes", () => {
    expect(service.getDownstream("light")).toEqual(["render"]);
    expect(service.getUpstream("render")).toEqual(["light"]);
  });

  it("reveals references for a shared node", () => {
    const revealed = service.revealReferences("light");
    expect(revealed.length).toBeGreaterThan(0);
  });

  it("computes dirty propagation for a params change", () => {
    const result = service.markDirty({
      sourceNodeId: "light",
      reason: "params_changed",
      timestamp: "t1",
    });
    expect(result.dirtyNodeIds).toContain("light");
    expect(result.dirtyNodeIds).toContain("render");
    expect(result.affectedClipIds).toEqual(["clip-a"]);
  });
});

describe("reference ops", () => {
  it("breakLink converts the target to local and removes the reference", () => {
    const nodes = {
      src: node("src"),
      dst: node("dst", { referenceType: "shared" }),
    };
    const references: Record<string, NodeReference> = {
      r1: {
        id: "r1",
        sourceNodeId: "src",
        targetNodeId: "dst",
        scope: "project",
        referenceType: "shared",
      },
    };
    const result = breakLink(nodes, references, "r1", "t1");
    expect(result.references.r1).toBeUndefined();
    expect(result.nodes.dst.referenceType).toBe("local");
  });

  it("makeLocal drops all references involving the node", () => {
    const nodes = { src: node("src"), dst: node("dst") };
    const references: Record<string, NodeReference> = {
      r1: {
        id: "r1",
        sourceNodeId: "src",
        targetNodeId: "dst",
        scope: "project",
        referenceType: "shared",
      },
    };
    const result = makeLocal(nodes, references, "src", "t1");
    expect(Object.keys(result.references)).toHaveLength(0);
    expect(result.nodes.src.referenceType).toBe("local");
  });

  it("overrideValue stores a patch without cloning the source node", () => {
    const nodes = {
      src: node("src"),
      dst: node("dst", { referenceType: "shared" }),
    };
    const references: Record<string, NodeReference> = {
      r1: {
        id: "r1",
        sourceNodeId: "src",
        targetNodeId: "dst",
        scope: "project",
        referenceType: "shared",
      },
    };
    const result = overrideValue(nodes, references, "r1", { intensity: 0.2 }, "t1");
    expect(result.references.r1.referenceType).toBe("instance");
    expect(result.references.r1.overridePatch).toEqual({ intensity: 0.2 });
    expect(result.nodes.dst.parameters.intensity).toBe(0.2);
    expect(result.nodes.src).toEqual(nodes.src);
  });
});
