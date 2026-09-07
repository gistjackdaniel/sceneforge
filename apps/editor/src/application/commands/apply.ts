import type { Project } from "../../domain/project/types";
import { connectNodes } from "../../domain/graph/connectNodes";
import { breakLink, makeLocal, overrideValue } from "../../domain/graph/referenceOps";
import { applyDirtyEventToNodes } from "../../domain/graph/dependencyService";
import { collectAllEdges } from "../../domain/graph/dirty";
import { computeNodeContentHash } from "../../domain/graph/cacheKey";
import { clipStartFrame, clipDurationFrames, withClipTiming } from "../../domain/timeline/timing";
import { createClipVariant, setActiveVariant } from "../../domain/timeline/variants";
import { linkWorldToClip } from "../services/worldLinking";
import { applyCameraRigToProject } from "../services/cameraCraft";
import type { CommandResult, DomainCommand, DomainEvent } from "./types";

const event = (type: DomainEvent["type"], payload: Record<string, unknown>, timestamp: string): DomainEvent => ({
  type,
  timestamp,
  payload,
});

export interface ApplyCommandContext {
  timestamp: string;
}

/**
 * Apply a domain command to a project. Returns inverse for undo.
 * Does not touch React or the editor store.
 */
export const applyCommand = (
  project: Project,
  command: DomainCommand,
  ctx: ApplyCommandContext,
): { project: Project; result: CommandResult } => {
  const timestamp = ctx.timestamp;
  const fail = (reason: string): { project: Project; result: CommandResult } => ({
    project,
    result: { ok: false, command, events: [], reason },
  });

  switch (command.type) {
    case "CREATE_NODE": {
      if (project.nodes[command.node.id]) {
        return fail("Node already exists.");
      }
      const node = {
        ...command.node,
        params: command.node.parameters,
        updatedAt: timestamp,
      };
      node.contentHash = computeNodeContentHash(node);
      let nextProject: Project = {
        ...project,
        nodes: { ...project.nodes, [node.id]: node },
      };
      if (command.clipGraphId) {
        const graph = nextProject.clipGraphs[command.clipGraphId];
        if (!graph) {
          return fail("Clip graph not found.");
        }
        nextProject = {
          ...nextProject,
          clipGraphs: {
            ...nextProject.clipGraphs,
            [graph.id]: {
              ...graph,
              nodeIds: graph.nodeIds.includes(node.id) ? graph.nodeIds : [...graph.nodeIds, node.id],
            },
          },
        };
      }
      return {
        project: nextProject,
        result: {
          ok: true,
          command,
          inverse: { type: "DELETE_NODE", nodeId: node.id },
          events: [event("NodeCreated", { nodeId: node.id }, timestamp)],
        },
      };
    }
    case "DELETE_NODE": {
      const node = project.nodes[command.nodeId];
      if (!node) {
        return fail("Node not found.");
      }
      const clipGraphId = Object.values(project.clipGraphs).find((graph) =>
        graph.nodeIds.includes(node.id),
      )?.id;
      const nodes = { ...project.nodes };
      delete nodes[node.id];
      const clipGraphs = Object.fromEntries(
        Object.entries(project.clipGraphs).map(([id, graph]) => [
          id,
          {
            ...graph,
            nodeIds: graph.nodeIds.filter((nodeId) => nodeId !== node.id),
            edges: graph.edges.filter(
              (edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id,
            ),
          },
        ]),
      );
      return {
        project: { ...project, nodes, clipGraphs },
        result: {
          ok: true,
          command,
          inverse: { type: "CREATE_NODE", node, clipGraphId },
          events: [event("NodeDeleted", { nodeId: node.id }, timestamp)],
        },
      };
    }
    case "LINK_CLIP_WORLD": {
      const clip = project.clips[command.clipId];
      if (!clip) {
        return fail("현재 선택된 클립이 없습니다.");
      }
      const previousWorldId = clip.linkedWorldId ?? null;
      if (command.worldId === null) {
        const refs = Object.values(project.clipGraphs[clip.clipGraphId]?.nodeIds ?? [])
          .map((id) => project.nodes[id])
          .filter((node) => node?.kind === "WorldReferenceNode");
        const nodes = { ...project.nodes };
        refs.forEach((node) => {
          if (!node) {
            return;
          }
          delete nodes[node.id];
        });
        const graph = project.clipGraphs[clip.clipGraphId];
        const refIds = new Set(refs.map((node) => node?.id));
        const nextProject: Project = {
          ...project,
          clips: {
            ...project.clips,
            [clip.id]: { ...clip, linkedWorldId: undefined, worldMode: undefined },
          },
          nodes,
          clipGraphs: graph
            ? {
                ...project.clipGraphs,
                [graph.id]: {
                  ...graph,
                  nodeIds: graph.nodeIds.filter((id) => !refIds.has(id)),
                  edges: graph.edges.filter(
                    (edge) => !refIds.has(edge.sourceNodeId) && !refIds.has(edge.targetNodeId),
                  ),
                },
              }
            : project.clipGraphs,
        };
        return {
          project: nextProject,
          result: {
            ok: true,
            command,
            inverse: previousWorldId
              ? { type: "LINK_CLIP_WORLD", clipId: command.clipId, worldId: previousWorldId }
              : undefined,
            events: [event("NodeParamsChanged", { clipId: clip.id, worldId: null }, timestamp)],
          },
        };
      }
      const linked = linkWorldToClip(project, {
        clipId: command.clipId,
        worldId: command.worldId,
        timestamp,
      });
      if (linked.reason) {
        return fail(linked.reason);
      }
      if (linked.alreadyLinked) {
        return {
          project,
          result: { ok: true, command, events: [] },
        };
      }
      return {
        project: linked.project,
        result: {
          ok: true,
          command,
          inverse: { type: "LINK_CLIP_WORLD", clipId: command.clipId, worldId: previousWorldId },
          events: [
            event("NodeParamsChanged", { nodeId: linked.nodeId, worldId: command.worldId }, timestamp),
            event("NodeMarkedDirty", { nodeId: linked.nodeId }, timestamp),
          ],
        },
      };
    }
    case "UPDATE_NODE_PARAMS": {
      const node = project.nodes[command.nodeId];
      if (!node) {
        return fail("Node not found.");
      }
      const previous = { ...node.parameters };
      const parameters = command.previous
        ? { ...command.patch }
        : { ...node.parameters, ...command.patch };
      const patched = {
        ...node,
        parameters,
        params: parameters,
        updatedAt: timestamp,
      };
      patched.contentHash = computeNodeContentHash(patched);
      const withNode: Project = {
        ...project,
        nodes: { ...project.nodes, [node.id]: patched },
      };
      const { nodes, result: dirty } = applyDirtyEventToNodes(
        {
          nodes: withNode.nodes,
          references: withNode.references,
          clipGraphs: withNode.clipGraphs,
          dependencyMap: withNode.dependencyMap,
        },
        { sourceNodeId: node.id, reason: "params_changed", timestamp },
      );
      return {
        project: { ...withNode, nodes },
        result: {
          ok: true,
          command,
          inverse: { type: "UPDATE_NODE_PARAMS", nodeId: node.id, patch: previous, previous: parameters },
          events: [
            event("NodeParamsChanged", { nodeId: node.id, patch: command.patch }, timestamp),
            event("NodeMarkedDirty", { dirtyNodeIds: dirty.dirtyNodeIds, affectedClipIds: dirty.affectedClipIds }, timestamp),
          ],
        },
      };
    }
    case "UPDATE_NODE_UI": {
      const node = project.nodes[command.nodeId];
      if (!node) {
        return fail("Node not found.");
      }
      return {
        project: {
          ...project,
          nodes: {
            ...project.nodes,
            [node.id]: { ...node, ui: { ...node.ui, ...command.ui } },
          },
        },
        result: {
          ok: true,
          command,
          inverse: { type: "UPDATE_NODE_UI", nodeId: node.id, ui: node.ui ?? {}, previous: command.ui },
          events: [event("NodeUiChanged", { nodeId: node.id }, timestamp)],
        },
      };
    }
    case "RENAME_NODE": {
      const node = project.nodes[command.nodeId];
      if (!node) {
        return fail("Node not found.");
      }
      return {
        project: {
          ...project,
          nodes: { ...project.nodes, [node.id]: { ...node, name: command.name, updatedAt: timestamp } },
        },
        result: {
          ok: true,
          command,
          inverse: { type: "RENAME_NODE", nodeId: node.id, name: node.name, previous: command.name },
          events: [event("NodeUiChanged", { nodeId: node.id, name: command.name }, timestamp)],
        },
      };
    }
    case "CONNECT_NODES": {
      const graph = project.clipGraphs[command.clipGraphId];
      if (!graph) {
        return fail("Clip graph not found.");
      }
      const connected = connectNodes(graph.edges, command.edge);
      if (!connected.ok || !connected.edges) {
        return fail(connected.reason ?? "Connect failed.");
      }
      return {
        project: {
          ...project,
          clipGraphs: {
            ...project.clipGraphs,
            [graph.id]: { ...graph, edges: connected.edges },
          },
        },
        result: {
          ok: true,
          command,
          inverse: { type: "DISCONNECT_NODES", clipGraphId: graph.id, edgeId: command.edge.id, edge: command.edge },
          events: [event("NodeReferenceChanged", { edgeId: command.edge.id }, timestamp)],
        },
      };
    }
    case "DISCONNECT_NODES": {
      const graph = project.clipGraphs[command.clipGraphId];
      if (!graph) {
        return fail("Clip graph not found.");
      }
      const edge = graph.edges.find((item) => item.id === command.edgeId);
      return {
        project: {
          ...project,
          clipGraphs: {
            ...project.clipGraphs,
            [graph.id]: { ...graph, edges: graph.edges.filter((item) => item.id !== command.edgeId) },
          },
        },
        result: {
          ok: true,
          command,
          inverse: edge
            ? { type: "CONNECT_NODES", clipGraphId: graph.id, edge }
            : undefined,
          events: [event("NodeReferenceChanged", { edgeId: command.edgeId }, timestamp)],
        },
      };
    }
    case "BREAK_LINK": {
      const mutated = breakLink(project.nodes, project.references, command.referenceId, timestamp);
      return {
        project: { ...project, nodes: mutated.nodes, references: mutated.references },
        result: {
          ok: true,
          command,
          events: [event("NodeReferenceChanged", { referenceId: command.referenceId, action: "break" }, timestamp)],
        },
      };
    }
    case "MAKE_LOCAL": {
      const mutated = makeLocal(project.nodes, project.references, command.nodeId, timestamp);
      return {
        project: { ...project, nodes: mutated.nodes, references: mutated.references },
        result: {
          ok: true,
          command,
          events: [event("NodeReferenceChanged", { nodeId: command.nodeId, action: "make_local" }, timestamp)],
        },
      };
    }
    case "OVERRIDE_VALUE": {
      const mutated = overrideValue(
        project.nodes,
        project.references,
        command.referenceId,
        command.patch,
        timestamp,
      );
      const { nodes, result: dirty } = applyDirtyEventToNodes(
        {
          nodes: mutated.nodes,
          references: mutated.references,
          clipGraphs: project.clipGraphs,
          dependencyMap: project.dependencyMap,
        },
        { sourceNodeId: project.references[command.referenceId]?.sourceNodeId ?? "", reason: "params_changed", timestamp },
      );
      return {
        project: { ...project, nodes, references: mutated.references },
        result: {
          ok: true,
          command,
          events: [
            event("NodeReferenceChanged", { referenceId: command.referenceId, action: "override" }, timestamp),
            event("NodeMarkedDirty", { dirtyNodeIds: dirty.dirtyNodeIds }, timestamp),
          ],
        },
      };
    }
    case "UPDATE_CLIP_TIMING": {
      const clip = project.clips[command.clipId];
      if (!clip) {
        return fail("Clip not found.");
      }
      const previous = {
        startFrame: clipStartFrame(clip),
        durationFrames: clipDurationFrames(clip),
      };
      return {
        project: {
          ...project,
          clips: {
            ...project.clips,
            [clip.id]: withClipTiming(clip, command.startFrame, command.durationFrames),
          },
        },
        result: {
          ok: true,
          command,
          inverse: {
            type: "UPDATE_CLIP_TIMING",
            clipId: clip.id,
            startFrame: previous.startFrame,
            durationFrames: previous.durationFrames,
            previous: { startFrame: command.startFrame, durationFrames: command.durationFrames },
          },
          events: [event("ClipTimingChanged", { clipId: clip.id }, timestamp)],
        },
      };
    }
    case "CREATE_VARIANT": {
      const clip = project.clips[command.clipId];
      if (!clip) {
        return fail("Clip not found.");
      }
      return {
        project: {
          ...project,
          clips: {
            ...project.clips,
            [clip.id]: createClipVariant(clip, command.variantId, command.name),
          },
        },
        result: {
          ok: true,
          command,
          inverse: { type: "SET_ACTIVE_VARIANT", clipId: clip.id, variantId: clip.activeVariantId ?? "main" },
          events: [event("VariantChanged", { clipId: clip.id, variantId: command.variantId }, timestamp)],
        },
      };
    }
    case "SET_ACTIVE_VARIANT": {
      const clip = project.clips[command.clipId];
      if (!clip) {
        return fail("Clip not found.");
      }
      return {
        project: {
          ...project,
          clips: {
            ...project.clips,
            [clip.id]: setActiveVariant(clip, command.variantId),
          },
        },
        result: {
          ok: true,
          command,
          inverse: {
            type: "SET_ACTIVE_VARIANT",
            clipId: clip.id,
            variantId: clip.activeVariantId ?? "main",
            previous: command.variantId,
          },
          events: [event("VariantChanged", { clipId: clip.id, variantId: command.variantId }, timestamp)],
        },
      };
    }
    case "INVALIDATE_CACHE": {
      const { nodes, result: dirty } = applyDirtyEventToNodes(
        {
          nodes: project.nodes,
          references: project.references,
          clipGraphs: project.clipGraphs,
          dependencyMap: project.dependencyMap,
        },
        { sourceNodeId: command.nodeId, reason: "manual_invalidate", timestamp },
      );
      return {
        project: { ...project, nodes },
        result: {
          ok: true,
          command,
          events: [event("CacheInvalidated", { nodeId: command.nodeId, affectedClipIds: dirty.affectedClipIds }, timestamp)],
        },
      };
    }
    case "APPLY_CAMERA_RIG": {
      if (command.restore) {
        const { rigNodeId, pathNodeId, rigParameters, pathParameters, createdRig } = command.restore;
        let nodes = { ...project.nodes };
        if (createdRig) {
          delete nodes[rigNodeId];
        } else if (rigParameters && nodes[rigNodeId]) {
          nodes[rigNodeId] = {
            ...nodes[rigNodeId],
            parameters: rigParameters,
            params: rigParameters,
            updatedAt: timestamp,
          };
          nodes[rigNodeId].contentHash = computeNodeContentHash(nodes[rigNodeId]);
        }
        if (pathParameters && nodes[pathNodeId]) {
          nodes[pathNodeId] = {
            ...nodes[pathNodeId],
            parameters: pathParameters,
            params: pathParameters,
            updatedAt: timestamp,
          };
          nodes[pathNodeId].contentHash = computeNodeContentHash(nodes[pathNodeId]);
        }
        const clipGraphs = createdRig
          ? Object.fromEntries(
              Object.entries(project.clipGraphs).map(([id, graph]) => [
                id,
                { ...graph, nodeIds: graph.nodeIds.filter((nodeId) => nodeId !== rigNodeId) },
              ]),
            )
          : project.clipGraphs;
        return {
          project: { ...project, nodes, clipGraphs },
          result: {
            ok: true,
            command,
            events: [event("NodeParamsChanged", { nodeId: pathNodeId, preset: command.preset }, timestamp)],
          },
        };
      }
      const clip = project.clips[command.clipId];
      const pathNodeId = clip ? (clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`) : "";
      const rigNodeId = clip ? `node-${clip.id}-camera` : "";
      const previousPath = pathNodeId ? project.nodes[pathNodeId]?.parameters : undefined;
      const previousRig = rigNodeId ? project.nodes[rigNodeId]?.parameters : undefined;
      const createdRig = Boolean(clip) && !project.nodes[rigNodeId];
      const applied = applyCameraRigToProject(project, {
        clipId: command.clipId,
        preset: command.preset,
        durationFrames: command.durationFrames,
        startPosition: command.startPosition,
        startRotation: command.startRotation,
        focalLengthMm: command.focalLengthMm,
        timestamp,
      });
      if ("reason" in applied) {
        return fail(applied.reason);
      }
      return {
        project: applied.project,
        result: {
          ok: true,
          command,
          inverse: {
            type: "APPLY_CAMERA_RIG",
            clipId: command.clipId,
            preset: command.preset,
            durationFrames: command.durationFrames,
            startPosition: command.startPosition,
            startRotation: command.startRotation,
            restore: {
              rigParameters: previousRig ?? null,
              pathParameters: previousPath,
              createdRig,
              rigNodeId: applied.rigNodeId,
              pathNodeId: applied.pathNodeId,
            },
          },
          events: [
            event("NodeParamsChanged", { nodeId: applied.rigNodeId, preset: command.preset }, timestamp),
            event("NodeMarkedDirty", { nodeId: applied.pathNodeId }, timestamp),
          ],
        },
      };
    }
    default:
      return fail(`Unhandled command ${command.type}.`);
  }
};

/** Edges helper kept for callers that rebuild adjacency after a command. */
export const projectEdges = collectAllEdges;
