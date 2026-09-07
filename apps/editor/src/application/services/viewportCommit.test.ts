import { describe, expect, it } from "vitest";
import { computeNodeContentHash } from "../../domain/graph/cacheKey";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import { resolveViewportRepresentation, worldOverlayAvailability } from "../../domain/worlds/viewportRepresentation";
import {
  assertMotionSeparation,
  buildCameraKeyframePatch,
  buildPlacementParams,
  eulerToQuaternionApprox,
  nodeKindForObject,
  quaternionToEulerApprox,
} from "./viewportCommit";

const now = "2026-01-01T00:00:00.000Z";

describe("viewport representation", () => {
  it("falls back to mesh when gaussian splat is not renderable", () => {
    const world = normalizeWorldAsset({
      id: "w1",
      name: "W",
      representation: "gaussian_splat",
      visualLayer3dgsPath: "a.ply",
      surfaceMeshPath: "a.glb",
      rootUri: "a.glb",
    });
    expect(resolveViewportRepresentation(world).kind).toBe("mesh");
  });

  it("reports gaussian splat for splat-only worlds", () => {
    const world = normalizeWorldAsset({
      id: "w2",
      name: "W",
      representation: "gaussian_splat",
      visualLayer3dgsPath: "a.ply",
      rootUri: "worlds/w2",
    });
    const plan = resolveViewportRepresentation(world);
    expect(plan.kind).toBe("gaussian_splat");
    expect(plan.uri).toBe("a.ply");
  });

  it("disables overlays that the world does not contain", () => {
    const world = normalizeWorldAsset({
      id: "w3",
      name: "W",
      rootUri: "worlds/w3",
      elements: [{ id: "elem-a", name: "A", kind: "actor_mark", description: "" }],
    });
    const availability = worldOverlayAvailability(world);
    expect(availability.actorMarks.available).toBe(true);
    expect(availability.walkableZones.available).toBe(false);
    expect(availability.walkableZones.reason).toBeTruthy();
  });
});

describe("viewport transform commit", () => {
  it("stores object gizmo commits on Placement/ActorPlacement nodes", () => {
    expect(nodeKindForObject("actor")).toBe("ActorPlacementNode");
    expect(nodeKindForObject("prop")).toBe("PlacementNode");
    const params = buildPlacementParams({
      worldElementId: "elem-a",
      kind: "actor",
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
      layer: "clip",
    });
    expect(params.worldElementId).toBe("elem-a");
    expect(params).not.toHaveProperty("overlayVisible");
  });

  it("stores camera commits on CameraPathNode, not object motion nodes", () => {
    expect(nodeKindForObject("camera")).toBe("CameraPathNode");
    expect(() => assertMotionSeparation("CameraPathNode", "camera")).not.toThrow();
    expect(() => assertMotionSeparation("CameraPathNode", "actor")).toThrow();
    const patch = buildCameraKeyframePatch({}, {
      frame: 12,
      position: [2, 1, 3],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    });
    expect(patch.keyframes).toHaveLength(1);
    const euler: [number, number, number] = [0.2, -0.4, 0.1];
    const roundTrip = quaternionToEulerApprox(eulerToQuaternionApprox(euler));
    expect(roundTrip[0]).toBeCloseTo(euler[0], 5);
    expect(roundTrip[1]).toBeCloseTo(euler[1], 5);
    expect(roundTrip[2]).toBeCloseTo(euler[2], 5);
  });

  it("does not change content hash when overlay visibility is view state only", () => {
    const node: NodeBase = {
      id: "place",
      name: "Place",
      kind: "PlacementNode",
      type: "PlacementNode",
      category: "cinematic",
      scope: "clip",
      enabled: true,
      tags: [],
      version: 1,
      referenceType: "local",
      parameters: buildPlacementParams({
        worldElementId: "elem-a",
        kind: "prop",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        layer: "clip",
      }),
      params: {},
      downstreamNodeIds: [],
      status: "clean",
      inputPorts: defaultPorts().inputPorts,
      outputPorts: defaultPorts().outputPorts,
      createdAt: now,
      updatedAt: now,
    };
    node.params = node.parameters;
    const hash = computeNodeContentHash(node);
    const withUi: NodeBase = { ...node, ui: { position: { x: 10, y: 10 } } };
    expect(computeNodeContentHash(withUi)).toBe(hash);
  });
});
