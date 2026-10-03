import type { DomainCommand } from "./types";
import type { Project } from "../../domain/project/types";
import { createNodeBase } from "../services/nodeFactory";
import {
  buildPlacementParams,
  nodeKindForObject,
  placementNodeIdForElement,
  type ViewportObjectKind,
} from "../services/viewportCommit";

export interface ViewportPickInput {
  worldElementId: string;
  kind: Exclude<ViewportObjectKind, "camera">;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: [number, number, number];
}

/**
 * ViewportPickCommand maps a viewport world-element pick to a single DomainCommand
 * that creates or updates a placement node referencing the element. This keeps
 * UI-independent mapping logic testable and undoable.
 */
export class ViewportPickCommand {
  static forClip(project: Project, clipId: string, pick: ViewportPickInput, timestamp: string): DomainCommand {
    const nodeId = placementNodeIdForElement(clipId, pick.worldElementId);
    const exists = Boolean(project.nodes[nodeId]);
    const params = buildPlacementParams({ ...pick, layer: "clip" });
    if (!exists) {
      const node = createNodeBase({
        id: nodeId,
        name: `${pick.kind} ${pick.worldElementId}`,
        kind: nodeKindForObject(pick.kind),
        category: "cinematic",
        parameters: params,
        timestamp,
        downstreamNodeIds: [`node-${clipId}-render`],
      });
      const clipGraphId = project.clips[clipId]?.clipGraphId;
      return clipGraphId
        ? { type: "CREATE_NODE", node, clipGraphId }
        : { type: "CREATE_NODE", node };
    }
    return { type: "UPDATE_NODE_PARAMS", nodeId, patch: params };
  }
}

