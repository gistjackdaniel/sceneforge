import { z } from "zod";
import type { NodeBase } from "../graph/types";
import type { WorldAsset } from "./types";

export const vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const objectPoseSchema = z.object({
  position: vector3Schema,
  rotation: vector3Schema,
  scale: vector3Schema.default([1, 1, 1]),
});
export const objectKeyframeSchema = objectPoseSchema.extend({ frame: z.number().int().nonnegative() });
export const objectTrackSchema = z.object({
  targetElementId: z.string().min(1),
  interpolation: z.enum(["linear", "hold"]).default("linear"),
  keyframes: z.array(objectKeyframeSchema),
});
export type ObjectPose = z.infer<typeof objectPoseSchema>;
export type ObjectKeyframe = z.infer<typeof objectKeyframeSchema>;
export type ObjectTrack = z.infer<typeof objectTrackSchema>;
export type SceneObject = ObjectPose & {
  id: string;
  name: string;
  kind: "actor" | "prop" | "light";
  representation: "marker" | "box" | "sphere" | "mesh";
  uri?: string;
  visible: boolean;
  locked: boolean;
  color: string;
  intensity: number;
  posePrompt?: string;
};

export const objectTrackNodeId = (clipId: string, elementId: string) => `node-${clipId}-motion-${elementId}`;

export const readObjectTrack = (parameters: unknown): ObjectTrack | undefined => {
  const parsed = objectTrackSchema.safeParse(parameters);
  return parsed.success ? parsed.data : undefined;
};

export const upsertObjectKeyframe = (track: ObjectTrack, keyframe: ObjectKeyframe): ObjectTrack => ({
  ...track,
  keyframes: [...track.keyframes.filter((item) => item.frame !== keyframe.frame), objectKeyframeSchema.parse(keyframe)]
    .sort((left, right) => left.frame - right.frame),
});

export const sampleObjectTrack = (track: ObjectTrack | undefined, frame: number): ObjectPose | undefined => {
  const keys = track?.keyframes.slice().sort((left, right) => left.frame - right.frame);
  if (!keys?.length) return undefined;
  const after = keys.findIndex((item) => item.frame > frame);
  if (after === 0) return keys[0];
  if (after < 0) return keys[keys.length - 1];
  const left = keys[after - 1];
  const right = keys[after];
  if (track?.interpolation === "hold") return left;
  const amount = (frame - left.frame) / (right.frame - left.frame);
  const mix = (start: number[], end: number[], angular = false): [number, number, number] =>
    start.map((value, axis) => {
      const delta = end[axis] - value;
      return value + (angular ? Math.atan2(Math.sin(delta), Math.cos(delta)) : delta) * amount;
    }) as [number, number, number];
  return { position: mix(left.position, right.position), rotation: mix(left.rotation, right.rotation, true), scale: mix(left.scale, right.scale) };
};

const recordVector = (input: unknown, fallback: [number, number, number]): [number, number, number] => {
  const parsed = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).safeParse(input);
  return parsed.success ? [parsed.data.x, parsed.data.y, parsed.data.z] : fallback;
};

export const resolveSceneObjects = (world: WorldAsset | undefined, nodes: NodeBase[]): SceneObject[] => {
  const objects = new Map<string, SceneObject>();
  world?.elements.filter((element) => ["actor_mark", "socket", "light_socket", "zone"].includes(element.kind)).forEach((element) => {
    const kind = element.kind === "actor_mark" ? "actor" : element.kind === "light_socket" ? "light" : "prop";
    objects.set(element.id, {
      id: element.id, name: element.name, kind, representation: "marker",
      position: kind === "actor" ? [-0.6, 0.05, 0.2] : kind === "light" ? [0.4, 2, -0.8] : [0.4, 0.05, 0.2],
      rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: false, color: "#d8d2c4", intensity: 2,
    });
  });
  nodes.filter((node) => node.enabled && ["PlacementNode", "ActorPlacementNode", "LightingRigNode"].includes(node.kind)).forEach((node) => {
    const params = node.parameters;
    const id = params.worldElementId;
    if (typeof id !== "string") return;
    const previous = objects.get(id);
    const representation = ["box", "sphere", "mesh"].includes(String(params.representation)) ? params.representation as SceneObject["representation"] : previous?.representation ?? "marker";
    objects.set(id, {
      id, name: typeof params.label === "string" ? params.label : previous?.name ?? node.name,
      kind: node.kind === "LightingRigNode" ? "light" : node.kind === "ActorPlacementNode" ? "actor" : "prop",
      representation, uri: typeof params.uri === "string" ? params.uri : undefined,
      position: recordVector(params.position, previous?.position ?? [0, 0.5, 0]),
      rotation: recordVector(params.rotation, [0, 0, 0]), scale: recordVector(params.scale, [1, 1, 1]),
      visible: params.visible !== false, locked: params.locked === true,
      color: typeof params.color === "string" && /^#[0-9a-f]{6}$/i.test(params.color) ? params.color : "#d8d2c4",
      intensity: typeof params.intensity === "number" && Number.isFinite(params.intensity) ? Math.max(0, params.intensity) : 2,
      posePrompt: typeof params.posePrompt === "string" ? params.posePrompt : previous?.posePrompt,
    });
  });
  return [...objects.values()];
};
