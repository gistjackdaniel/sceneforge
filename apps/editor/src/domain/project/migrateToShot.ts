import { cameraPathParamsFromNode, type CameraKeyframe } from "../graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode } from "../graph/lens";
import type { NodeBase } from "../graph/types";
import { clipDurationFrames } from "../timeline/timing";
import { objectKeyframeSchema, readObjectTrack, resolveSceneObjects, type ObjectTrack, type SceneObject } from "../worlds/sceneObjects";
import { z } from "zod";
import type { AssetRecord } from "../assets/types";
import { parseShot, shotSchema } from "../shot/schema";
import type { AssetId, CameraTake, Motion, Shot, Subject, SubjectId, TakeId } from "../shot/types";
import type { Project } from "./types";
import type { TimelineClip } from "../timeline/types";

const brand = <T extends string>(value: string) => value as T;

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const vec = (value: readonly number[] | undefined, fallback: [number, number, number]): [number, number, number] =>
  value && value.length === 3 && value.every((item) => Number.isFinite(item))
    ? [value[0], value[1], value[2]]
    : fallback;

const assetFor = (object: SceneObject): { assetId: AssetId; uri: string; type: AssetRecord["type"] } => {
  if (object.kind === "light") return { assetId: brand<AssetId>("primitive:light"), uri: "primitive:light", type: "lighting_preset" };
  if (object.representation === "mesh" && object.uri) {
    return { assetId: brand<AssetId>(`file:${hashText(object.uri)}`), uri: object.uri, type: object.kind === "actor" ? "actor" : "mesh" };
  }
  if (object.representation === "box" || object.representation === "sphere") {
    const id = object.representation === "box" ? "primitive:box" : "primitive:sphere";
    return { assetId: brand<AssetId>(id), uri: id, type: "prop" };
  }
  return { assetId: brand<AssetId>("primitive:marker"), uri: "primitive:marker", type: "prop" };
};

const graphNodes = (project: Project, clip: TimelineClip): NodeBase[] => {
  const graph = project.clipGraphs[clip.clipGraphId];
  if (!graph) return [];
  return graph.nodeIds.flatMap((id) => {
    const node = project.nodes[id];
    return node?.enabled ? [node] : [];
  });
};

const keysFrom = (parameters: Record<string, unknown>): ObjectTrack["keyframes"] => {
  const parsed = z.array(objectKeyframeSchema).safeParse(parameters.keyframes);
  return parsed.success ? parsed.data : [];
};

const trackFor = (clip: TimelineClip, elementId: string, nodes: NodeBase[]): ObjectTrack | undefined => {
  const placementId = `node-${clip.id}-placement-${elementId}`;
  for (const node of nodes) {
    if (node.kind !== "ObjectTrajectoryNode") continue;
    const targetElement = node.parameters.targetElementId;
    const targetNode = node.parameters.targetNodeId;
    const matches = targetElement === elementId
      || targetNode === placementId
      || targetNode === elementId
      || node.id === `node-${clip.id}-motion-${elementId}`;
    if (!matches) continue;
    const parsed = readObjectTrack(node.parameters);
    if (parsed) return parsed;
    const keyframes = keysFrom(node.parameters);
    if (keyframes.length === 0) continue;
    const interpolation = node.parameters.interpolation === "hold" ? "hold" : "linear";
    return { targetElementId: elementId, interpolation, keyframes };
  }
  return undefined;
};

const explicitKeys = (track: ObjectTrack, duration: number) => {
  const keys = track.keyframes
    .filter((key) => key.frame < duration)
    .map((key) => ({
      frame: key.frame,
      position: vec(key.position, [0, 0, 0]),
      rotationEuler: vec(key.rotation, [0, 0, 0]),
      scale: vec(key.scale, [1, 1, 1]),
    }));
  return keys.length > 0 ? keys : undefined;
};

const subjectFrom = (object: SceneObject, track: ObjectTrack | undefined, duration: number): Subject => {
  const asset = assetFor(object);
  const placement = {
    position: vec(object.position, [0, 0.5, 0]),
    rotationEuler: vec(object.rotation, [0, 0, 0]),
    scale: vec(object.scale, [1, 1, 1]),
  };
  const base = {
    id: brand<SubjectId>(object.id),
    assetId: asset.assetId,
    assetVersion: 1,
    name: object.name || "Subject",
    uri: asset.uri,
    placement,
    visible: object.visible,
    locked: object.locked,
  };
  if (object.kind === "light") {
    return {
      ...base,
      kind: "light",
      representation: "light",
      intensity: Number.isFinite(object.intensity) ? Math.max(0, object.intensity) : 2,
      color: /^#[0-9a-fA-F]{6}$/.test(object.color) ? object.color : "#d8d2c4",
    };
  }
  const keys = track ? explicitKeys(track, duration) : undefined;
  const motion: Motion = keys
    ? { channel: "explicit", interpolation: track?.interpolation === "hold" ? "hold" : "linear", keys: keys as [typeof keys[0], ...typeof keys], provenance: { kind: "keyed" } }
    : object.posePrompt?.trim()
      ? { channel: "text", prompt: object.posePrompt.trim() }
      : { channel: "unset" };
  return {
    ...base,
    kind: object.kind === "actor" ? "human" : "object",
    representation: object.representation,
    motion,
  };
};

const cameraKeys = (keys: CameraKeyframe[], duration: number) =>
  keys
    .filter((key) => Number.isInteger(key.frame) && key.frame >= 0 && key.frame < duration && key.focalLengthMm > 0)
    .map((key) => ({
      frame: key.frame,
      position: vec(key.position, [0, 1.6, 4]),
      rotation: key.rotation.length === 4 && key.rotation.every((item) => Number.isFinite(item))
        ? [key.rotation[0], key.rotation[1], key.rotation[2], key.rotation[3]] as [number, number, number, number]
        : [0, 0, 0, 1] as [number, number, number, number],
      focalLengthMm: key.focalLengthMm,
      focusDistanceM: key.focusDistanceM && key.focusDistanceM > 0 ? key.focusDistanceM : undefined,
      aperture: key.aperture && key.aperture > 0 ? key.aperture : undefined,
    }));

/** One-way read of a clip graph into a shot. Later loads keep a schema-valid shot. */
export const migrateClipToShot = (project: Project, clip: TimelineClip): Shot | undefined => {
  const duration = Math.max(1, Math.round(clipDurationFrames(clip) || 1));
  const sequence = project.sequences[project.activeSequenceId];
  const fps = sequence?.fps && sequence.fps > 0 ? sequence.fps : 24;
  const nodes = graphNodes(project, clip);
  const world = clip.linkedWorldId ? project.worlds[clip.linkedWorldId] : undefined;
  const objects = resolveSceneObjects(world, nodes);
  const subjects = objects.map((object) => subjectFrom(object, trackFor(clip, object.id, nodes), duration));
  const cameraNodeId = clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
  const cameraNode = project.nodes[cameraNodeId];
  const params = cameraPathParamsFromNode(cameraNode?.enabled === false ? {} : cameraNode?.parameters ?? {});
  const takes: CameraTake[] = params.takes.flatMap((take) => {
    const keys = cameraKeys(take.keyframes, duration);
    if (keys.length === 0) return [];
    return [{
      schemaVersion: 1 as const,
      id: brand<TakeId>(take.id),
      name: take.name || "Take",
      source: take.source === "record" ? "record" as const : "manual" as const,
      keys: keys as [typeof keys[0], ...typeof keys],
      createdAt: take.createdAt || project.updatedAt,
    }];
  });
  const lensNode = project.nodes[lensNodeIdForClip(clip.id)];
  const lens = lensParamsFromNode(lensNode?.parameters ?? {});
  const interpolation = params.interpolation === "catmull_rom" ? "catmull_rom" : "linear";
  const selected = takes.find((take) => take.id === params.activeTakeId) ?? takes[0];
  const camera = selected
    ? { status: "ready" as const, lens, interpolation, selectedTakeId: selected.id, takes: takes as [CameraTake, ...CameraTake[]] }
    : { status: "empty" as const, lens, interpolation };
  try {
    return parseShot({
      schemaVersion: 1,
      id: clip.id,
      name: clip.name || "Shot",
      time: { fps, durationFrames: duration, origin: "clip_local" },
      subjects,
      camera,
      environment: clip.linkedWorldId ? { worldId: clip.linkedWorldId } : undefined,
      renders: [],
    });
  } catch {
    return undefined;
  }
};

const assetRecord = (subject: Subject, stamped: string): AssetRecord => ({
  id: subject.assetId,
  type: subject.kind === "human" ? "actor" : subject.kind === "light" ? "lighting_preset" : subject.representation === "mesh" ? "mesh" : "prop",
  name: subject.name,
  uri: subject.uri,
  contentHash: subject.assetId,
  metadata: {},
  semanticTags: ["shot"],
  version: subject.assetVersion,
  createdAt: stamped,
  updatedAt: stamped,
});

/** Fills `project.shots` from the active sequence. A shot that already validates is left untouched. */
export const projectWithShots = <T extends Project>(project: T): T => {
  const sequence = project.sequences[project.activeSequenceId];
  const clipIds = sequence?.clipIds?.length ? sequence.clipIds : Object.keys(project.clips);
  const shots: NonNullable<Project["shots"]> = { ...(project.shots ?? {}) };
  const assets = { ...project.assets };
  for (const clipId of clipIds) {
    if (shotSchema.safeParse(shots[clipId]).success) continue;
    const clip = project.clips[clipId];
    if (!clip) continue;
    const shot = migrateClipToShot(project, clip);
    if (!shot) continue;
    shots[shot.id] = shot;
    for (const subject of shot.subjects) {
      if (!assets[subject.assetId]) assets[subject.assetId] = assetRecord(subject, project.updatedAt);
    }
  }
  return { ...project, shots, assets };
};
