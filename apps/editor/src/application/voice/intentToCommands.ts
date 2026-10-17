import type { VoiceIntent } from "../ports/IntentParser";
import type { TargetMatch as ResolvedTarget } from "../../domain/worlds/query";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import type { Project } from "../../domain/project/types";
import { placementNodeIdForElement } from "../services/viewportCommit";
import { objectTrackNodeId, objectKeyframeSchema, readObjectTrack, upsertObjectKeyframe } from "../../domain/worlds/sceneObjects";
import type { DomainCommand } from "../commands/types";

export interface IntentMappingContext {
  project: Project;
  /** Active clip id required to map to camera/object nodes. */
  clipId: string;
  /** Loop time in seconds. PRD#16 intended; main currently stores keyframes as frames. */
  tSeconds: number;
  /** Sequence FPS for temporary t→frame compatibility on main (documented in PR). */
  fps?: number;
}

export interface IntentMappingResult {
  commands: DomainCommand[];
  /** For ambiguous or destructive actions requiring confirmation. */
  confirmation?: {
    reason: "ambiguous" | "destructive" | "low_confidence";
    options?: Array<{ id: string; displayName: string }>;
  };
}

const toFrame = (tSeconds: number, fps = 24): number => Math.max(0, Math.round(tSeconds * fps));

export const mapVoiceIntentToCommands = (
  intent: VoiceIntent,
  resolved: ResolvedTarget[],
  ctx: IntentMappingContext,
): IntentMappingResult => {
  const { project, clipId, tSeconds } = ctx;
  const fps = ctx.fps ?? 24;
  const clip = project.clips[clipId];
  if (!clip) return { commands: [] };

  // Confirmation gates
  if (intent.confidence < 0.5) {
    return { commands: [], confirmation: { reason: "low_confidence" } };
  }
  if ((intent.verb === "remove" || intent.verb === "swap-location") && resolved.length > 0) {
    return {
      commands: [],
      confirmation: {
        reason: "destructive",
        options: resolved.map((r) => ({ id: r.assetId, displayName: r.displayName })),
      },
    };
  }
  if (resolved.length > 1) {
    return {
      commands: [],
      confirmation: {
        reason: "ambiguous",
        options: resolved.map((r) => ({ id: r.assetId, displayName: r.displayName })),
      },
    };
  }

  const frame = toFrame(tSeconds, fps); // Object tracks remain frame-based; camera uses t-seconds DomainCommands
  const commands: DomainCommand[] = [];

  if (intent.verb === "look-at") {
    const target = resolved[0];
    const nodeId = clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
    const node = project.nodes[nodeId];
    if (!node) return { commands: [] };
    const current = cameraPathParamsFromNode(node.parameters);
    commands.push({
      type: "UPDATE_NODE_PARAMS",
      nodeId,
      patch: {
        ...current,
        lookAtTargetElementId: target?.assetId,
        trackingStrength: 0.7,
      },
    });
    return { commands };
  }

  if (intent.verb === "move" || intent.verb === "rotate" || intent.verb === "pose") {
    const target = resolved[0];
    if (!target) {
      // Default to camera pose if no target explicitly matched
      const nodeId = clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
      const node = project.nodes[nodeId];
      if (!node) return { commands: [] };
      const current = cameraPathParamsFromNode(node.parameters);
      const last =
        current.keyframes.find((k) => k.frame === frame) ??
        current.keyframes[current.keyframes.length - 1] ?? {
          frame,
          position: [2.5, 1.8, 3.2] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          focalLengthMm: 35,
        };
      // Simple relative move on X/Z/Y by 1m if provided
      const delta = typeof intent.params.amount === "number" ? intent.params.amount : 1;
      const axis = String(intent.params.direction ?? "forward");
      const move = (pos: [number, number, number]): [number, number, number] => {
        const v: [number, number, number] = [...pos] as [number, number, number];
        if (axis.includes("left")) v[0] -= delta;
        else if (axis.includes("right")) v[0] += delta;
        else if (axis.includes("forward")) v[2] -= delta;
        else if (axis.includes("back")) v[2] += delta;
        else if (axis.includes("up")) v[1] += delta;
        else if (axis.includes("down")) v[1] -= delta;
        else if (axis === "x") v[0] += delta;
        else if (axis === "y") v[1] += delta;
        else if (axis === "z") v[2] += delta;
        return v;
      };
      const nextPosition = intent.verb === "move" ? move(last.position) : last.position;
      commands.push({
        type: "UPDATE_CAMERA_KEYFRAME",
        clipId,
        t: tSeconds,
        position: nextPosition,
        quaternion: last.rotation,
      });
      return { commands };
    }
    // Object pose keyframe on track node
    const nodeId = objectTrackNodeId(clip.id, target.assetId);
    const node = project.nodes[nodeId];
    const track = readObjectTrack(node?.parameters) ?? {
      targetElementId: target.assetId,
      interpolation: "linear" as const,
      keyframes: [],
    };
    // naive default pose composition
    const last =
      track.keyframes.find((k) => k.frame === frame) ??
      track.keyframes[track.keyframes.length - 1] ?? {
        frame,
        position: [0, 0.5, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      };
    const delta = typeof intent.params.amount === "number" ? intent.params.amount : 1;
    const axis = String(intent.params.direction ?? "forward");
    const move = (pos: [number, number, number]): [number, number, number] => {
      const v: [number, number, number] = [...pos] as [number, number, number];
      if (axis.includes("left")) v[0] -= delta;
      else if (axis.includes("right")) v[0] += delta;
      else if (axis.includes("forward")) v[2] -= delta;
      else if (axis.includes("back")) v[2] += delta;
      else if (axis.includes("up")) v[1] += delta;
      else if (axis.includes("down")) v[1] -= delta;
      else if (axis === "x") v[0] += delta;
      else if (axis === "y") v[1] += delta;
      else if (axis === "z") v[2] += delta;
      return v;
    };
    const nextKey = objectKeyframeSchema.parse({
      frame,
      position: intent.verb === "move" ? move(last.position) : last.position,
      rotation: last.rotation,
      scale: last.scale,
    });
    const nextTrack = upsertObjectKeyframe(track, nextKey);
    const exist = Boolean(node);
    if (exist) {
      commands.push({ type: "UPDATE_NODE_PARAMS", nodeId, patch: nextTrack });
    } else {
      // ensure placement node exists is handled elsewhere; we store a track node
      commands.push({
        type: "CREATE_NODE",
        node: {
          id: nodeId,
          name: `Motion · ${target.assetId}`,
          kind: "ObjectTrajectoryNode",
          type: "ObjectTrajectoryNode",
          category: "cinematic",
          scope: "clip",
          enabled: true,
          tags: [],
          version: 1,
          referenceType: "local",
          parameters: nextTrack,
          params: nextTrack as unknown as Record<string, unknown>,
          downstreamNodeIds: [`node-${clip.id}-render`],
          inputPorts: [{ id: "in", label: "in", kind: "data" }],
          outputPorts: [{ id: "out", label: "out", kind: "data" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: "clean",
        } as any,
        clipGraphId: clip.clipGraphId,
      });
    }
    return { commands };
  }

  // Unsupported intents return empty commands for now
  return { commands: [] };
};

