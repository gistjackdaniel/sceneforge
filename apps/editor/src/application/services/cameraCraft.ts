import type { Project } from "../../domain/project/types";
import type { CameraRigPreset } from "../../domain/graph/cameraRig";
import { buildRigPreset, cameraRigNodeIdForClip } from "../../domain/graph/cameraRig";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { computeNodeContentHash } from "../../domain/graph/cacheKey";
import { applyDirtyEventToNodes } from "../../domain/graph/dependencyService";
import { createNodeBase } from "./nodeFactory";
import { cameraPathNodeIdForClip } from "./viewportCommit";

export const applyCameraRigToProject = (
  project: Project,
  input: {
    clipId: string;
    preset: CameraRigPreset;
    durationFrames: number;
    startPosition: [number, number, number];
    startRotation: [number, number, number];
    focalLengthMm?: number;
    timestamp: string;
  },
): { project: Project; rigNodeId: string; pathNodeId: string; createdRig: boolean } | { reason: string } => {
  const clip = project.clips[input.clipId];
  if (!clip) {
    return { reason: "현재 선택된 클립이 없습니다." };
  }
  const graph = project.clipGraphs[clip.clipGraphId];
  if (!graph) {
    return { reason: "클립 그래프를 찾을 수 없습니다." };
  }
  const built = buildRigPreset({
    preset: input.preset,
    durationFrames: input.durationFrames,
    start: { position: input.startPosition, rotation: input.startRotation },
    focalLengthMm: input.focalLengthMm,
  });
  const rigNodeId = cameraRigNodeIdForClip(clip.id);
  const pathNodeId = cameraPathNodeIdForClip(clip);
  const createdRig = !project.nodes[rigNodeId];
  const existingRig = project.nodes[rigNodeId];
  const rigNode = existingRig
    ? {
        ...existingRig,
        parameters: { ...existingRig.parameters, ...built.rig },
        params: { ...existingRig.parameters, ...built.rig },
        updatedAt: input.timestamp,
      }
    : createNodeBase({
        id: rigNodeId,
        name: "Camera Rig",
        kind: "CameraRigNode",
        category: "cinematic",
        parameters: { ...built.rig },
        timestamp: input.timestamp,
        downstreamNodeIds: [`node-${clip.id}-render`],
      });
  rigNode.contentHash = computeNodeContentHash(rigNode);

  const pathNode = project.nodes[pathNodeId];
  const nodes = { ...project.nodes, [rigNodeId]: rigNode };
  if (pathNode) {
    const current = cameraPathParamsFromNode(pathNode.parameters);
    const nextPath = { ...current, keyframes: built.keyframes, frameCount: built.rig.durationFrames };
    nodes[pathNodeId] = {
      ...pathNode,
      parameters: { ...pathNode.parameters, ...nextPath },
      params: { ...pathNode.parameters, ...nextPath },
      updatedAt: input.timestamp,
    };
    nodes[pathNodeId].contentHash = computeNodeContentHash(nodes[pathNodeId]);
  }

  const nextNodeIds = graph.nodeIds.includes(rigNodeId) ? graph.nodeIds : [...graph.nodeIds, rigNodeId];
  let nextProject: Project = {
    ...project,
    nodes,
    clipGraphs: {
      ...project.clipGraphs,
      [graph.id]: { ...graph, nodeIds: nextNodeIds },
    },
  };
  const dirtySource = pathNode ? pathNodeId : rigNodeId;
  const dirtied = applyDirtyEventToNodes(
    {
      nodes: nextProject.nodes,
      references: nextProject.references,
      clipGraphs: nextProject.clipGraphs,
      dependencyMap: nextProject.dependencyMap,
    },
    { sourceNodeId: dirtySource, reason: "params_changed", timestamp: input.timestamp },
  );
  nextProject = { ...nextProject, nodes: dirtied.nodes };
  return { project: nextProject, rigNodeId, pathNodeId, createdRig };
};

export const validateLookAtElement = (
  elementId: string | undefined,
  elements: Array<{ id: string }>,
): { ok: true } | { ok: false; reason: string } => {
  if (!elementId) {
    return { ok: true };
  }
  if (!elements.some((item) => item.id === elementId)) {
    return { ok: false, reason: "Look-at target was deleted or is not a world element ID." };
  }
  return { ok: true };
};
