import { describe, expect, it } from "vitest";
import { assetFromWorld, createAssetRecord } from "../assets/registry";
import { normalizeNodeKind } from "../graph/types";
import { migrateProject } from "./migrate";
import type { Project } from "./types";
import {
  deserializeProject,
  serializeProject,
} from "../../infrastructure/persistence/serializeProject";

const emptyDependencyMap = {
  downstreamByNodeId: {},
  clipsByNodeId: {},
  referencesByNodeId: {},
  cacheHashesByClipId: {},
};

const minimalProject = (): Project => {
  const now = "2026-01-01T00:00:00.000Z";
  const world = {
    id: "world-1",
    name: "World",
    description: "",
    representation: "hybrid" as const,
    sourceAssetIds: [] as string[],
    rootUri: "worlds/world-1",
    coordinateSystem: "Y_UP" as const,
    unitScaleMeters: 1,
    semanticTags: [] as string[],
    version: 1,
    createdAt: now,
    updatedAt: now,
    usdPath: "",
    semanticsPath: "",
    navmeshPath: "",
    previewPath: "worlds/world-1/preview.glb",
    proxyKind: "usd" as const,
    elements: [],
    props: [],
  };
  const asset = assetFromWorld(world);
  return {
    id: "project-1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: {
      editLatencyMs: 1,
      regenerationCount: 0,
      nodeReuseRate: 0,
      cacheHitRate: 0,
    },
    activeSequenceId: "seq-1",
    sequences: {
      "seq-1": {
        id: "seq-1",
        name: "Main",
        clipIds: ["clip-1"],
        playhead: 0,
        visibleRange: [0, 100],
      },
    },
    clips: {
      "clip-1": {
        id: "clip-1",
        name: "Clip",
        start: 0,
        end: 100,
        duration: 100,
        sourceType: "empty",
        clipGraphId: "graph-1",
        cacheStatus: "valid",
        cameraTrajectoryNodeId: "node-path",
      },
    },
    clipGraphs: {
      "graph-1": {
        id: "graph-1",
        clipId: "clip-1",
        rootNodeId: "node-clip",
        nodeIds: ["node-clip", "node-path"],
        edges: [
          {
            id: "e1",
            source: "node-clip",
            target: "node-path",
            label: "legacy",
          } as never,
        ],
        previewFrames: [],
        finalFrames: [],
        keyframeNodeIds: [],
      },
    },
    nodes: {
      "node-clip": {
        id: "node-clip",
        name: "Clip",
        kind: "TimelineClipNode",
        type: "TimelineClipNode",
        category: "capture",
        scope: "clip",
        enabled: true,
        tags: [],
        version: 1,
        referenceType: "local",
        parameters: { clipId: "clip-1" },
        params: { clipId: "clip-1" },
        downstreamNodeIds: [],
        status: "clean",
        contentHash: "abc123",
        inputPorts: [],
        outputPorts: [],
        createdAt: now,
        updatedAt: now,
      },
      "node-path": {
        id: "node-path",
        name: "Path",
        kind: "CameraTrajectoryNode" as never,
        type: "CameraTrajectoryNode",
        category: "cinematic",
        scope: "clip",
        enabled: true,
        tags: [],
        version: 1,
        referenceType: "hard_link" as never,
        parameters: {},
        params: {},
        downstreamNodeIds: [],
        status: "clean",
        inputPorts: [],
        outputPorts: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    references: {
      r1: {
        id: "r1",
        sourceNodeId: "node-clip",
        targetNodeId: "node-path",
        scope: "clip",
        referenceType: "instance",
      },
    },
    dependencyMap: emptyDependencyMap,
    worlds: { [world.id]: world },
    assets: { [asset.id]: asset },
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
};

describe("serialization + migrate", () => {
  it("round-trips project ids and upgrades envelope to v2", () => {
    const project = migrateProject(minimalProject(), {
      buildDependencyMap: () => emptyDependencyMap,
      syncClipCacheFields: (clip) => clip,
    });
    const raw = serializeProject(project);
    const envelope = JSON.parse(raw) as { version: number };
    expect(envelope.version).toBe(2);

    const loaded = deserializeProject(raw);
    expect(loaded.id).toBe("project-1");
    expect(loaded.nodes["node-clip"].id).toBe("node-clip");
    expect(Object.keys(loaded.assets)).toContain("asset-world-1");
  });

  it("migrates legacy kinds, references, edges, and world manifest fields", () => {
    const migrated = migrateProject(minimalProject(), {
      buildDependencyMap: () => emptyDependencyMap,
      syncClipCacheFields: (clip) => clip,
    });

    expect(migrated.nodes["node-path"].kind).toBe("CameraPathNode");
    expect(migrated.nodes["node-path"].referenceType).toBe("shared");
    expect(migrated.nodes["node-path"].status).toBe("clean");
    expect(migrated.nodes["node-path"].contentHash).toBeUndefined();
    expect(migrated.nodes["node-clip"].contentHash).toBe("abc123");

    expect(migrated.clips["clip-1"].cameraPathNodeId).toBe("node-path");
    expect(migrated.clips["clip-1"].performancePlanNodeId).toBe("node-clip-1-performance");
    expect(migrated.nodes["node-clip-1-performance"].kind).toBe("PerformancePlanNode");
    expect(migrated.clipGraphs["graph-1"].nodeIds).toContain("node-clip-1-performance");
    expect(migrated.clipGraphs["graph-1"].edges[0].sourceNodeId).toBe("node-clip");
    expect(migrated.clipGraphs["graph-1"].edges[0].targetNodeId).toBe("node-path");

    expect(migrated.worlds["world-1"].representation).toBe("hybrid");
    expect(migrated.worlds["world-1"].coordinateSystem).toBe("Y_UP");
    expect(migrated.worlds["world-1"].unitScaleMeters).toBe(1);
    expect(migrated.references.r1.referenceType).toBe("instance");
  });

  it("seeds splat and point-cloud samples when the apartment world is present", () => {
    const project = minimalProject();
    project.worlds = {
      "world-apartment-livingroom": {
        ...project.worlds["world-1"],
        id: "world-apartment-livingroom",
        name: "Apartment Livingroom",
        rootUri: "worlds/apartment_livingroom",
        previewPath: "worlds/apartment_livingroom/preview.glb",
      },
    };
    const migrated = migrateProject(project, {
      buildDependencyMap: () => emptyDependencyMap,
      syncClipCacheFields: (clip) => clip,
    });
    expect(migrated.worlds["world-color-block-splat"]?.representation).toBe("gaussian_splat");
    expect(migrated.worlds["world-color-block-points"]?.representation).toBe("point_cloud");
  });

  it("normalizes §7.2 kind aliases", () => {
    expect(normalizeNodeKind("WorldGenerateNode")).toBe("ImageToWorldNode");
    expect(normalizeNodeKind("PromptNode")).toBe("TextSourceNode");
    expect(normalizeNodeKind("PropPlacementNode")).toBe("PlacementNode");
    expect(normalizeNodeKind("WorldRefNode")).toBe("WorldReferenceNode");
  });

  it("keeps asset identity stable", () => {
    const asset = createAssetRecord({
      id: "asset-stable",
      type: "image",
      name: "Plate",
      uri: "assets/plate.png",
      contentHash: "deadbeef",
    });
    expect(asset.id).toBe("asset-stable");
    expect(asset.contentHash).toBe("deadbeef");
  });
});
