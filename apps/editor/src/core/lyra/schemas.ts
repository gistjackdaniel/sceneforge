import { z } from "zod";

const lyraJobStatusSchema = z.enum(["idle", "queued", "running", "completed", "failed"]);

const cameraTrajectorySchema = z.object({
  label: z.string(),
  frameCount: z.number(),
});

const stageKeyframePoseSchema = z.object({
  playhead: z.number(),
  camera: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    rotation: z.tuple([z.number(), z.number(), z.number()]),
    focalLength: z.number(),
  }),
  objects: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["actor", "prop", "light"]),
      position: z.tuple([z.number(), z.number(), z.number()]),
      rotation: z.tuple([z.number(), z.number(), z.number()]),
    }),
  ),
});

const worldArtifactsSchema = z.object({
  spatialMemoryPath: z.string(),
  visualLayer3dgsPath: z.string(),
  surfaceMeshPath: z.string(),
  generatedSegmentPath: z.string().optional(),
});

export const lyraVideoRenderInputSchema = z.object({
  clipId: z.string(),
  prompt: z.string().optional(),
  keyframes: z.array(stageKeyframePoseSchema),
  cameraTrajectory: cameraTrajectorySchema,
  worldArtifacts: worldArtifactsSchema,
  memoryCoverage: z.number(),
});

export const lyraVideoRenderOutputSchema = z.object({
  jobId: z.string(),
  renderedVideoPath: z.string(),
  consistencyScore: z.number(),
  usedMemoryCoverage: z.number(),
});

export const lyraVideoRenderJobStateSchema = z.object({
  jobId: z.string(),
  status: lyraJobStatusSchema,
  progress: z.number(),
  message: z.string(),
  input: lyraVideoRenderInputSchema,
  output: lyraVideoRenderOutputSchema.optional(),
  error: z.string().optional(),
});

export const lyraJobStateSchema = z.object({
  jobId: z.string(),
  status: lyraJobStatusSchema,
  progress: z.number(),
  message: z.string(),
  input: z.object({
    sourceImagePath: z.string(),
    sourceImageName: z.string(),
    cameraTrajectory: cameraTrajectorySchema,
    prompt: z.string().optional(),
  }),
  output: z
    .object({
      jobId: z.string(),
      generatedSegmentPath: z.string(),
      spatialMemoryPath: z.string(),
      visualLayer3dgsPath: z.string(),
      surfaceMeshPath: z.string(),
      navmeshPath: z.string().optional(),
      collisionMeshPath: z.string().optional(),
      memoryCoverage: z.number(),
      generatedAreaRatio: z.number(),
    })
    .optional(),
  error: z.string().optional(),
});
