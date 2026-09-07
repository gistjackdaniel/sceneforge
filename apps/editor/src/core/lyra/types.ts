import type { DirectionChannelInvalidation } from "../../domain/direction";
import type { DirectionCapabilityNegotiation } from "../../domain/rendering/capabilities";
import type { CameraContinuityValidation } from "../../domain/graph/continuity";

export type LyraJobStatus = "idle" | "queued" | "running" | "completed" | "failed";

export interface CameraTrajectoryInput {
  /** Placeholder until trajectory editor ships; maps to Lyra trajectory.npz in P1-B cloud path. */
  label: string;
  frameCount: number;
}

export interface LyraWorldGenerateInput {
  sourceImagePath: string;
  sourceImageName: string;
  cameraTrajectory: CameraTrajectoryInput;
  prompt?: string;
}

export interface LyraWorldGenerateOutput {
  jobId: string;
  generatedSegmentPath: string;
  spatialMemoryPath: string;
  visualLayer3dgsPath: string;
  surfaceMeshPath: string;
  navmeshPath?: string;
  collisionMeshPath?: string;
  memoryCoverage: number;
  generatedAreaRatio: number;
}

export interface LyraJobState {
  jobId: string;
  status: LyraJobStatus;
  progress: number;
  message: string;
  input: LyraWorldGenerateInput;
  output?: LyraWorldGenerateOutput;
  error?: string;
}

export interface StageKeyframePose {
  playhead: number;
  camera: {
    position: [number, number, number];
    rotation: [number, number, number];
    focalLength: number;
  };
  objects: Array<{
    id: string;
    kind: "actor" | "prop" | "light";
    position: [number, number, number];
    rotation: [number, number, number];
  }>;
}

export interface LyraWorldArtifacts {
  spatialMemoryPath: string;
  visualLayer3dgsPath: string;
  surfaceMeshPath: string;
  generatedSegmentPath?: string;
}

export interface ShotDirectionKeyframe {
  frame: number;
  position: [number, number, number];
  rotationQuaternion: [number, number, number, number];
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
}

export interface ShotStagingAnchor {
  id: string;
  kind: "actor" | "prop" | "light";
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface ShotDirectionInput {
  source: "3d_previs";
  cameraPathNodeId: string;
  keyframes: ShotDirectionKeyframe[];
  lens: {
    focalLengthMm: number;
    focusDistanceM?: number;
    aperture?: number;
    sensorPreset?: "full-frame" | "super35" | "micro-four-thirds";
  };
  lookAtTargetElementId?: string;
  continuity?: {
    lineOfActionLabel: string;
    lineActorAId?: string;
    lineActorBId?: string;
    cameraSide: "left" | "right" | "unlocked";
    screenDirection: "left_to_right" | "right_to_left" | "neutral";
  };
  continuityValidation?: CameraContinuityValidation;
  stagingAnchors: ShotStagingAnchor[];
  allowedSignals: Array<
    | "composition"
    | "camera_motion"
    | "lens"
    | "spatial_staging"
    | "eyeline"
    | "screen_direction"
    | "action_boundaries"
  >;
  ignoredCharacterSignals: Array<
    | "body_mechanics"
    | "contact"
    | "facial_performance"
    | "cloth_motion"
    | "previs_interpolation"
  >;
}

export interface PerformanceDirectionInput {
  source: "external_performance";
  planNodeId: string;
  sources: Array<{
    id: string;
    type: "text_prompt" | "live_action" | "motion_capture" | "key_animation_2d";
    label: string;
    uri?: string;
    assetId?: string;
    notes?: string;
    qualityGate?: {
      status: "unreviewed" | "approved" | "rejected";
      trackingConfidence?: number;
      contactConfidence?: number;
      footSlidingScore?: number;
      notes?: string;
    };
  }>;
  cues: Array<{
    id: string;
    kind: "dialogue" | "reaction" | "action" | "hold";
    label: string;
    direction: string;
    startFrame: number;
    endFrame: number;
    actor?: string;
    actorId?: string;
    targetActorId?: string;
    sourceId?: string;
    reactionToCueId?: string;
    overlapMode?: "allow" | "avoid" | "interrupt";
  }>;
  audioGuide?: {
    label: string;
    uri?: string;
    assetId?: string;
    offsetFrame: number;
    durationFrames?: number;
    transcript?: string;
  };
}

export interface DirectionContractInput {
  version: 2;
  separationPolicy: "shot_and_performance";
  capabilityNegotiation: DirectionCapabilityNegotiation;
  shot: ShotDirectionInput;
  performance: PerformanceDirectionInput;
}

export interface DirectionRerenderScope {
  mode: "full" | "partial";
  invalidations: DirectionChannelInvalidation[];
}

export interface LyraVideoRenderInput {
  clipId: string;
  prompt?: string;
  keyframes: StageKeyframePose[];
  cameraTrajectory: CameraTrajectoryInput;
  worldArtifacts: LyraWorldArtifacts;
  memoryCoverage: number;
  /** Canonical connector contract. Legacy keyframes above are camera-only. */
  directionContract: DirectionContractInput;
  rerenderScope: DirectionRerenderScope;
}

export interface LyraVideoRenderOutput {
  jobId: string;
  renderedVideoPath: string;
  consistencyScore: number;
  usedMemoryCoverage: number;
}

export interface LyraVideoRenderJobState {
  jobId: string;
  status: LyraJobStatus;
  progress: number;
  message: string;
  input: LyraVideoRenderInput;
  output?: LyraVideoRenderOutput;
  error?: string;
}

/** Backend adapter for Lyra 2.0 world generation (stub or cloud GPU worker). */
export interface LyraAdapter {
  submitJob(input: LyraWorldGenerateInput): Promise<LyraJobState>;
  pollJob(jobId: string): Promise<LyraJobState>;
  submitVideoRenderJob(input: LyraVideoRenderInput): Promise<LyraVideoRenderJobState>;
  pollVideoRenderJob(jobId: string): Promise<LyraVideoRenderJobState>;
  cancelJob?(jobId: string): Promise<void>;
}
