import { z } from "zod";
import { objectTrackSchema, vector3Schema, resolveSceneObjects, readObjectTrack } from "../worlds/sceneObjects";
import type { WorldAsset } from "../worlds/types";
import type { NodeBase } from "../graph/types";
import type { TimelineClip } from "../timeline/types";
import { clipDurationFrames } from "../timeline/timing";
import { cameraPathParamsFromNode } from "../graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode } from "../graph/lens";

export const sceneConditioningSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("editable_scene"),
  delivery: z.literal("scene_encoder_required"),
  rasterKeyframes: z.literal("forbidden"),
  clipId: z.string(),
  time: z.object({ fps: z.number().positive(), durationFrames: z.number().int().positive(), frameOrigin: z.literal("clip_local") }),
  world: z.object({
    id: z.string(), version: z.number(), representation: z.string(), rootUri: z.string(),
    geometryUri: z.string().optional(), coordinateSystem: z.enum(["Y_UP", "Z_UP"]), unitScaleMeters: z.number().positive(),
  }).optional(),
  objects: z.array(z.object({
    id: z.string(), name: z.string(), kind: z.enum(["actor", "prop", "light"]),
    representation: z.enum(["marker", "box", "sphere", "mesh"]), uri: z.string().optional(),
    position: vector3Schema, rotation: vector3Schema, scale: vector3Schema,
    visible: z.boolean(), locked: z.boolean(), color: z.string(), intensity: z.number().nonnegative(),
    posePrompt: z.string().optional(),
  })),
  objectTracks: z.array(objectTrackSchema),
  recipe: z.array(z.object({ id: z.string(), kind: z.string(), version: z.number(), parameters: z.record(z.string(), z.unknown()) })),
  camera: z.object({
    interpolation: z.enum(["linear", "bezier", "catmull_rom"]),
    keyframes: z.array(z.object({
      frame: z.number().int().nonnegative(), position: vector3Schema,
      rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]), focalLengthMm: z.number().positive(),
      focusDistanceM: z.number().optional(), aperture: z.number().optional(),
    })),
    lookAtTargetElementId: z.string().optional(), trackingStrength: z.number().optional(),
  }),
  lens: z.object({ focalLengthMm: z.number(), focusDistanceM: z.number().optional(), aperture: z.number().optional(), sensorPreset: z.string().optional() }),
  outputAspect: z.string(),
});
export type SceneConditioning = z.infer<typeof sceneConditioningSchema>;

export const buildSceneConditioning = (clip: TimelineClip, nodes: NodeBase[], world?: WorldAsset, fps = 24, outputAspect = "16:9"): SceneConditioning => {
  const cameraId = clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
  const camera = cameraPathParamsFromNode(nodes.find((node) => node.id === cameraId)?.parameters ?? {});
  const durationFrames = Math.max(1, clipDurationFrames(clip));
  const enabled = nodes.filter((node) => node.enabled);
  const objectTracks = enabled.filter((node) => node.kind === "ObjectTrajectoryNode").flatMap((node) => {
    const track = readObjectTrack(node.parameters);
    return track ? [{ ...track, keyframes: track.keyframes.filter((key) => key.frame < durationFrames) }] : [];
  });
  const result = sceneConditioningSchema.parse({
    schemaVersion: 1, source: "editable_scene", delivery: "scene_encoder_required", rasterKeyframes: "forbidden", clipId: clip.id,
    time: { fps, durationFrames, frameOrigin: "clip_local" }, outputAspect,
    world: world && { id: world.id, version: world.version, representation: world.representation, rootUri: world.rootUri,
      geometryUri: world.surfaceMeshPath || world.visualLayer3dgsPath || (/\.(glb|gltf|ply|usd[ac]?)$/i.test(world.previewUri ?? "") ? world.previewUri : undefined),
      coordinateSystem: world.coordinateSystem, unitScaleMeters: world.unitScaleMeters },
    objects: resolveSceneObjects(world, enabled), objectTracks,
    camera: { ...camera, keyframes: camera.keyframes.filter((key) => key.frame >= 0 && key.frame < durationFrames) },
    lens: lensParamsFromNode(nodes.find((node) => node.id === lensNodeIdForClip(clip.id))?.parameters ?? {}),
    recipe: enabled.filter((node) => ["PlacementNode", "ActorPlacementNode", "LightingRigNode", "MaterialOverrideNode", "ObjectTrajectoryNode", "CameraRigNode"].includes(node.kind))
      .map((node) => ({ id: node.id, kind: node.kind, version: node.version, parameters: node.parameters })),
  });
  return structuredClone(result);
};

export const sceneLatentSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("scene_latent"),
  uri: z.string().min(1), sourceHash: z.string().min(1), encoderId: z.string().min(1), encoderVersion: z.string().min(1),
  latentSpace: z.string().min(1), shape: z.array(z.number().int().positive()).min(1), dtype: z.enum(["float16", "float32", "bfloat16"]),
});
export type SceneLatent = z.infer<typeof sceneLatentSchema>;
export interface SceneEncoder {
  encode(scene: SceneConditioning, signal: AbortSignal): Promise<SceneLatent>;
}
export interface SceneVideoBackend {
  latentSpace: string;
  generate(input: { latent: SceneLatent; scene: SceneConditioning }, signal: AbortSignal): Promise<{ videoUri: string }>;
}

export const generateFromScene = async (scene: SceneConditioning, encoder: SceneEncoder, backend: SceneVideoBackend, signal: AbortSignal) => {
  signal.throwIfAborted();
  const validated = sceneConditioningSchema.parse(scene);
  if (validated.world && (!validated.world.geometryUri || ["image_based_proxy", "video_based_proxy"].includes(validated.world.representation))) {
    throw new Error("An editable 3D world is required. Image proxies cannot be encoded as a scene.");
  }
  if (!validated.world && !validated.objects.some((object) => object.representation !== "marker")) {
    throw new Error("Add 3D geometry before encoding this scene.");
  }
  const latent = sceneLatentSchema.parse(await encoder.encode(validated, signal));
  signal.throwIfAborted();
  if (latent.latentSpace !== backend.latentSpace) throw new Error("Scene encoder and video model latent spaces do not match.");
  return backend.generate({ latent, scene: validated }, signal);
};
