import type { Project } from "../../domain/project/types";
import { connectNodes } from "../../domain/graph/connectNodes";
import { breakLink, makeLocal, overrideValue } from "../../domain/graph/referenceOps";
import { applyDirtyEventToNodes } from "../../domain/graph/dependencyService";
import { collectAllEdges } from "../../domain/graph/dirty";
import { computeNodeContentHash } from "../../domain/graph/cacheKey";
import { clipStartFrame, clipDurationFrames, withClipTiming } from "../../domain/timeline/timing";
import { createClipVariant, setActiveVariant } from "../../domain/timeline/variants";
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
    default:
      return fail(`Unhandled command ${command.type}.`);
  }
};

/** Edges helper kept for callers that rebuild adjacency after a command. */
export const projectEdges = collectAllEdges;
