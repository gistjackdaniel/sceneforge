import { defaultPorts, normalizeGraphEdge, normalizeNodeKind, type NodeBase } from "../graph/types";
import { normalizeReferenceType } from "../graph/references";
import { normalizeCacheStatus } from "../rendering/types";
import { assetFromWorld } from "../assets/registry";
import { normalizeWorldAsset } from "../worlds/normalize";
import { sampleViewportWorlds } from "../worlds/sampleWorlds";
import { migrateClipTiming } from "../timeline/timing";
import { ensureClipVariants } from "../timeline/variants";
import type { Project } from "./types";
import type { ClipGraph } from "./clipGraph";
import type { TimelineClip } from "../timeline/types";
import {
  createPerformancePlanNode,
  performancePlanFromNode,
  performancePlanNodeIdForClip,
} from "../performance";

type BuildDependencyMap = (
  nodes: Project["nodes"],
  clips: Project["clips"],
  references: Project["references"],
  clipGraphs: Project["clipGraphs"],
) => Project["dependencyMap"];

type SyncClipCacheFields = (
  clip: TimelineClip,
  caches: Project["caches"],
) => TimelineClip;

export const normalizeNodeBase = (node: NodeBase & Record<string, unknown>): NodeBase => {
  const kind = normalizeNodeKind(String(node.kind ?? node.type ?? "PlacementNode"));
  const ports = defaultPorts();
  const rawParameters = node.parameters ?? node.params ?? {};
  const parameters =
    kind === "PerformancePlanNode" ? performancePlanFromNode(rawParameters) : rawParameters;
  return {
    ...node,
    kind,
    type: kind,
    category: node.category,
    scope: node.scope,
    enabled: node.enabled ?? true,
    tags: node.tags ?? [],
    version: node.version ?? 1,
    referenceType: normalizeReferenceType(String(node.referenceType ?? "local")),
    parameters,
    params: parameters,
    downstreamNodeIds: node.downstreamNodeIds ?? [],
    status: node.status ?? (node.enabled === false ? "disabled" : "clean"),
    contentHash: node.contentHash,
    inputPorts: node.inputPorts ?? ports.inputPorts,
    outputPorts: node.outputPorts ?? ports.outputPorts,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    name: node.name,
    id: node.id,
  };
};

const normalizeClip = (clip: TimelineClip): TimelineClip => {
  const cameraPathNodeId =
    clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
  const performancePlanNodeId =
    clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
  return ensureClipVariants(
    migrateClipTiming({
      ...clip,
      cameraPathNodeId,
      performancePlanNodeId,
      cameraTrajectoryNodeId: cameraPathNodeId,
      graphSnapshotId: clip.graphSnapshotId ?? clip.clipGraphId,
      trackId: clip.trackId ?? "V1",
    }),
  );
};

const normalizeClipGraph = (graph: ClipGraph): ClipGraph => ({
  ...graph,
  edges: (graph.edges ?? []).map((edge) =>
    normalizeGraphEdge(edge as Parameters<typeof normalizeGraphEdge>[0]),
  ),
});

/** Normalize legacy persisted project data to current domain shapes. */
export const migrateProject = (
  project: Project,
  deps: {
    buildDependencyMap: BuildDependencyMap;
    syncClipCacheFields: SyncClipCacheFields;
  },
): Project => {
  let nodes = Object.fromEntries(
    Object.entries(project.nodes ?? {}).map(([id, node]) => [
      id,
      normalizeNodeBase(node as NodeBase & Record<string, unknown>),
    ]),
  );

  const references = Object.fromEntries(
    Object.entries(project.references ?? {}).map(([id, reference]) => [
      id,
      { ...reference, referenceType: normalizeReferenceType(reference.referenceType) },
    ]),
  );

  const caches = Object.fromEntries(
    Object.entries(project.caches ?? {}).map(([id, cache]) => [
      id,
      { ...cache, status: normalizeCacheStatus(cache.status) },
    ]),
  );

  const worlds = Object.fromEntries(
    Object.entries(project.worlds ?? {}).map(([id, world]) => [id, normalizeWorldAsset(world)]),
  );
  if (worlds["world-apartment-livingroom"]) {
    for (const sample of sampleViewportWorlds()) {
      if (!worlds[sample.id]) {
        worlds[sample.id] = sample;
      }
    }
  }

  let assets = { ...(project.assets ?? {}) };
  for (const world of Object.values(worlds)) {
    const asset = assetFromWorld(world);
    if (!assets[asset.id]) {
      assets[asset.id] = asset;
    }
    if (!world.sourceAssetIds.includes(asset.id)) {
      worlds[world.id] = {
        ...world,
        sourceAssetIds: [...world.sourceAssetIds, asset.id],
      };
    }
  }

  const clips = Object.fromEntries(
    Object.entries(project.clips ?? {}).map(([id, clip]) => {
      const normalized = normalizeClip(clip);
      return [id, deps.syncClipCacheFields(normalized, caches)];
    }),
  );

  let clipGraphs = Object.fromEntries(
    Object.entries(project.clipGraphs ?? {}).map(([id, graph]) => [id, normalizeClipGraph(graph)]),
  );

  const migrationTimestamp = project.updatedAt ?? project.createdAt ?? "1970-01-01T00:00:00.000Z";
  for (const clip of Object.values(clips)) {
    const performanceNodeId = clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
    const graph = clipGraphs[clip.clipGraphId];
    if (!nodes[performanceNodeId]) {
      nodes = {
        ...nodes,
        [performanceNodeId]: createPerformancePlanNode(clip.id, migrationTimestamp),
      };
    }
    if (!graph) {
      continue;
    }
    const renderNodeId =
      graph.nodeIds.find((nodeId) => {
        const kind = nodes[nodeId]?.kind;
        return kind === "RenderSettingsNode" || kind === "StageRenderPassNode" || kind === "GenerativeRefinementNode";
      }) ?? `node-${clip.id}-render`;
    const hasEdge = graph.edges.some(
      (edge) => edge.sourceNodeId === performanceNodeId && edge.targetNodeId === renderNodeId,
    );
    clipGraphs = {
      ...clipGraphs,
      [graph.id]: {
        ...graph,
        nodeIds: graph.nodeIds.includes(performanceNodeId)
          ? graph.nodeIds
          : [...graph.nodeIds, performanceNodeId],
        edges:
          !hasEdge && nodes[renderNodeId]
            ? [
                ...graph.edges,
                {
                  id: `edge-${clip.id}-performance-to-render`,
                  sourceNodeId: performanceNodeId,
                  sourcePort: "direction",
                  targetNodeId: renderNodeId,
                  targetPort: "in",
                  kind: "data" as const,
                  label: "performance direction",
                },
              ]
            : graph.edges,
      },
    };
  }

  let migrated: Project = {
    ...project,
    assets,
    nodes,
    references,
    caches,
    worlds,
    clips,
    clipGraphs,
  };

  migrated = {
    ...migrated,
    modelExecutions: migrated.modelExecutions ?? {},
    dependencyMap: deps.buildDependencyMap(
      migrated.nodes,
      migrated.clips,
      migrated.references,
      migrated.clipGraphs,
    ),
  };

  return {
    ...migrated,
    clips: Object.fromEntries(
      Object.entries(migrated.clips).map(([id, clip]) => [
        id,
        deps.syncClipCacheFields(clip, migrated.caches),
      ]),
    ),
  };
};
