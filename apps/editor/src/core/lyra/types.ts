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

export interface LyraVideoRenderInput {
  clipId: string;
  prompt?: string;
  keyframes: StageKeyframePose[];
  cameraTrajectory: CameraTrajectoryInput;
  worldArtifacts: LyraWorldArtifacts;
  memoryCoverage: number;
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
