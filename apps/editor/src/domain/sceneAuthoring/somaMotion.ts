import { z } from "zod";
import { quatSchema, vec3Schema } from "./contract";
import { addVec3, lerpVec3, quatMul, quatRotate, quatSlerp, type Quat, type Vec3 } from "./math";

export const KIMODO_SOMA_MODEL = "Kimodo-SOMA-RP-ArdyRep-v1.2";
/** ARDY's SOMA model in Kimodo's representation, recorded while steering an actor live. */
export const ARDY_SOMA_MODEL = "ARDY-SOMA-RP-30FPS-KimodoRep-Horizon60";
export const KIMODO_FPS = 30;
/** Kimodo generates at most ten seconds, and a prompt needs at least half a second. */
export const KIMODO_MAX_FRAMES = 300;
export const KIMODO_MIN_SEGMENT_FRAMES = 15;
const JOINT_COUNT = 77;
const MAX_SEGMENTS = 8;
const MAX_WAYPOINTS = 32;

const seedSchema = z.number().int().min(0).max(0x7fffffff);

/** One prompt and how many frames it runs; segments play back to back. */
export const kimodoSegmentSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(500),
  frames: z.number().int().min(KIMODO_MIN_SEGMENT_FRAMES).max(KIMODO_MAX_FRAMES),
});

/** A ground point the root reaches at a frame, in metres from the clip's first frame with the actor facing +Z. */
export const rootWaypointSchema = z.strictObject({
  frame: z.number().int().min(1).max(KIMODO_MAX_FRAMES - 1),
  x: z.number().min(-100).max(100),
  z: z.number().min(-100).max(100),
});

const recipeIsPlayable = ({ segments, waypoints }: { segments: readonly KimodoSegment[]; waypoints: readonly RootWaypoint[] }) => {
  const total = segments.reduce((sum, segment) => sum + segment.frames, 0);
  return total <= KIMODO_MAX_FRAMES && waypoints.every((point, index) => point.frame < total && (index === 0 || point.frame > waypoints[index - 1].frame));
};

export const somaGenerationRequestSchema = z.strictObject({
  segments: z.array(kimodoSegmentSchema).min(1).max(MAX_SEGMENTS),
  waypoints: z.array(rootWaypointSchema).max(MAX_WAYPOINTS),
  seed: seedSchema,
}).refine(recipeIsPlayable, "Prompts must fit in ten seconds, with waypoints in increasing frames inside them.");

export const somaFrameSchema = z.object({
  rootPosition: vec3Schema,
  rootRotation: quatSchema,
  rootHeading: z.number().min(-Math.PI - 1e-6).max(Math.PI + 1e-6),
  localRotations: z.array(quatSchema).length(JOINT_COUNT),
}).refine(({ rootRotation, localRotations }) =>
  rootRotation.every((coordinate, index) => coordinate === localRotations[0][index]),
  { path: ["rootRotation"], message: "The motion root and hips joint must have the same rotation." },
);

/** How a clip was generated. Clips from before the timeline record only `prompt`, the whole of their one segment. */
const provenanceSchema = z.object({
  model: z.enum([KIMODO_SOMA_MODEL, ARDY_SOMA_MODEL]),
  prompt: z.string().trim().min(1).max(MAX_SEGMENTS * 503),
  seed: seedSchema,
  fps: z.literal(KIMODO_FPS),
  segments: z.array(kimodoSegmentSchema).min(1).max(MAX_SEGMENTS).optional(),
  waypoints: z.array(rootWaypointSchema).max(MAX_WAYPOINTS).optional(),
});

export const somaMotionSchema = provenanceSchema.extend({
  schemaVersion: z.literal(1),
  joints: z.array(z.string().min(1).max(80)).length(JOINT_COUNT).refine(
    (joints) => joints[0] === "Hips" && new Set(joints).size === joints.length,
    "SOMA requires unique joints and Hips as the root.",
  ),
  jointParents: z.array(z.int()).length(JOINT_COUNT).refine(
    (parents) => parents[0] === -1 && parents.slice(1).every((parent, index) => parent >= 0 && parent <= index),
    "SOMA joints must follow their parents in the hierarchy.",
  ),
  jointOffsets: z.array(vec3Schema).length(JOINT_COUNT),
  frames: z.array(somaFrameSchema).min(1).max(300),
});

export const somaClipReferenceSchema = provenanceSchema.extend({
  uri: z.string().regex(/^\/(?:api\/kimodo\/clips\/[a-f0-9]{64}|motions\/[a-z0-9-]+)\.json$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  frameCount: z.number().int().min(1).max(300),
}).refine(({ uri, sha256 }) => !uri.startsWith("/api/") || uri.endsWith(`/${sha256}.json`), {
  path: ["uri"],
  message: "The clip URI must match its content hash.",
});

export type KimodoSegment = z.infer<typeof kimodoSegmentSchema>;
export type RootWaypoint = z.infer<typeof rootWaypointSchema>;
export type SomaGenerationRequest = z.infer<typeof somaGenerationRequestSchema>;
export type SomaMotion = z.infer<typeof somaMotionSchema>;
export type SomaFrame = z.infer<typeof somaFrameSchema>;
export type SomaClipReference = z.infer<typeof somaClipReferenceSchema>;

/** Sample between neighboring SOMA frames in source time, clamped to the clip. */
export function sampleSomaMotion(motion: SomaMotion, seconds: number): SomaFrame {
  const index = Math.max(0, Math.min(motion.frames.length - 1, seconds * motion.fps));
  const first = motion.frames[Math.floor(index)];
  const last = motion.frames[Math.ceil(index)];
  if (first === last) return first;
  const t = index - Math.floor(index);
  const localRotations = first.localRotations.map((rotation, joint) => quatSlerp(rotation, last.localRotations[joint], t));
  const headingChange = last.rootHeading - first.rootHeading;
  return {
    rootPosition: lerpVec3(first.rootPosition, last.rootPosition, t),
    rootRotation: localRotations[0],
    rootHeading: first.rootHeading + Math.atan2(Math.sin(headingChange), Math.cos(headingChange)) * t,
    localRotations,
  };
}

/** The actor's heading in radians around +Y, with SOMA's +Z forward. */
export function somaHeading(frame: SomaFrame): number {
  return frame.rootHeading;
}

/** Reconstruct the SOMA skeleton from its effective local rotations and rest offsets. */
export function somaJointPose(motion: SomaMotion, frame: SomaFrame): Array<{ position: Vec3; rotation: Quat }> {
  const resolved = [{ position: frame.rootPosition, rotation: frame.rootRotation }];
  for (let joint = 1; joint < motion.joints.length; joint += 1) {
    const parent = resolved[motion.jointParents[joint]];
    resolved.push({
      position: addVec3(parent.position, quatRotate(parent.rotation, motion.jointOffsets[joint])),
      rotation: quatMul(parent.rotation, frame.localRotations[joint]),
    });
  }
  return resolved;
}
