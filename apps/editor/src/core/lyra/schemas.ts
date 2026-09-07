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

const performanceSourceSchema = z.object({
  id: z.string(),
  type: z.enum(["text_prompt", "live_action", "motion_capture", "key_animation_2d"]),
  label: z.string(),
  uri: z.string().optional(),
  assetId: z.string().optional(),
  notes: z.string().optional(),
  qualityGate: z
    .object({
      status: z.enum(["unreviewed", "approved", "rejected"]),
      trackingConfidence: z.number().min(0).max(1).optional(),
      contactConfidence: z.number().min(0).max(1).optional(),
      footSlidingScore: z.number().min(0).max(1).optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

const performanceCueSchema = z.object({
  id: z.string(),
  kind: z.enum(["dialogue", "reaction", "action", "hold"]),
  label: z.string(),
  direction: z.string(),
  startFrame: z.number(),
  endFrame: z.number(),
  actor: z.string().optional(),
  actorId: z.string().optional(),
  targetActorId: z.string().optional(),
  sourceId: z.string().optional(),
  reactionToCueId: z.string().optional(),
  overlapMode: z.enum(["allow", "avoid", "interrupt"]).optional(),
});

const audioGuideSchema = z.object({
  label: z.string(),
  uri: z.string().optional(),
  assetId: z.string().optional(),
  offsetFrame: z.number(),
  durationFrames: z.number().optional(),
  transcript: z.string().optional(),
});

const directionChannelSchema = z.enum([
  "camera",
  "structure",
  "performance_body",
  "performance_face",
  "audio",
]);

const directionMaskSchema = z.object({
  uri: z.string().optional(),
  assetId: z.string().optional(),
});

const directionControlSchema = z.object({
  channel: directionChannelSchema,
  locked: z.boolean(),
  strength: z.number().min(0).max(1),
  mask: directionMaskSchema.optional(),
});

const directionCapabilityNegotiationSchema = z.object({
  connectorId: z.string(),
  connectorLabel: z.string(),
  channels: z.array(
    z.object({
      channel: directionChannelSchema,
      mode: z.enum(["unsupported", "prompt", "reference", "exact"]),
      status: z.enum(["accepted", "degraded", "unsupported"]),
      requested: directionControlSchema,
      applied: directionControlSchema,
      issues: z.array(z.string()),
    }),
  ),
  acceptedPerformanceSourceTypes: z.array(
    z.enum(["text_prompt", "live_action", "motion_capture", "key_animation_2d"]),
  ),
  rejectedPerformanceSourceTypes: z.array(
    z.enum(["text_prompt", "live_action", "motion_capture", "key_animation_2d"]),
  ),
  frameAccurateCues: z.enum(["accepted", "degraded", "unused"]),
  editedAudio: z.enum(["accepted", "degraded", "unused"]),
  warnings: z.array(z.string()),
});

const directionFrameRangeSchema = z.object({
  startFrame: z.number(),
  endFrame: z.number(),
});

const directionInvalidationSchema = z.object({
  channel: directionChannelSchema,
  frameRanges: z.array(directionFrameRangeSchema).optional(),
});

const cameraContinuityValidationSchema = z.object({
  status: z.enum(["unconfigured", "valid", "warning", "invalid"]),
  actorAId: z.string().optional(),
  actorBId: z.string().optional(),
  protectedSide: z.enum(["left", "right", "unlocked"]),
  samples: z.array(
    z.object({
      frame: z.number(),
      side: z.enum(["left", "right", "on_axis"]),
      signedDistance: z.number(),
    }),
  ),
  violationFrames: z.array(z.number()),
  issues: z.array(z.string()),
});

const directionContractSchema = z.object({
  version: z.literal(2),
  separationPolicy: z.literal("shot_and_performance"),
  capabilityNegotiation: directionCapabilityNegotiationSchema,
  shot: z.object({
    source: z.literal("3d_previs"),
    cameraPathNodeId: z.string(),
    keyframes: z.array(
      z.object({
        frame: z.number(),
        position: z.tuple([z.number(), z.number(), z.number()]),
        rotationQuaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        focalLengthMm: z.number(),
        focusDistanceM: z.number().optional(),
        aperture: z.number().optional(),
      }),
    ),
    lens: z.object({
      focalLengthMm: z.number(),
      focusDistanceM: z.number().optional(),
      aperture: z.number().optional(),
      sensorPreset: z.enum(["full-frame", "super35", "micro-four-thirds"]).optional(),
    }),
    lookAtTargetElementId: z.string().optional(),
    continuity: z
      .object({
        lineOfActionLabel: z.string(),
        lineActorAId: z.string().optional(),
        lineActorBId: z.string().optional(),
        cameraSide: z.enum(["left", "right", "unlocked"]),
        screenDirection: z.enum(["left_to_right", "right_to_left", "neutral"]),
      })
      .optional(),
    continuityValidation: cameraContinuityValidationSchema.optional(),
    stagingAnchors: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["actor", "prop", "light"]),
        position: z.tuple([z.number(), z.number(), z.number()]),
        rotation: z.tuple([z.number(), z.number(), z.number()]),
      }),
    ),
    allowedSignals: z.array(
      z.enum([
        "composition",
        "camera_motion",
        "lens",
        "spatial_staging",
        "eyeline",
        "screen_direction",
        "action_boundaries",
      ]),
    ),
    ignoredCharacterSignals: z.array(
      z.enum([
        "body_mechanics",
        "contact",
        "facial_performance",
        "cloth_motion",
        "previs_interpolation",
      ]),
    ),
  }),
  performance: z.object({
    source: z.literal("external_performance"),
    planNodeId: z.string(),
    sources: z.array(performanceSourceSchema),
    cues: z.array(performanceCueSchema),
    audioGuide: audioGuideSchema.optional(),
  }),
});

export const lyraVideoRenderInputSchema = z.object({
  clipId: z.string(),
  prompt: z.string().optional(),
  keyframes: z.array(stageKeyframePoseSchema),
  cameraTrajectory: cameraTrajectorySchema,
  worldArtifacts: worldArtifactsSchema,
  memoryCoverage: z.number(),
  rerenderScope: z.object({
    mode: z.enum(["full", "partial"]),
    invalidations: z.array(directionInvalidationSchema),
  }),
  directionContract: directionContractSchema,
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
