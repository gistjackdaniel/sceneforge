export interface StageRenderPassArtifact {
  backgroundRgb?: string;
  actorRgb?: string;
  propRgb?: string;
  depth?: string;
  mask?: string;
  normal?: string;
  motionVector?: string;
  objectId?: string;
}

export interface StageRenderPassResult {
  passId: string;
  clipId: string;
  createdAt: string;
  artifacts: StageRenderPassArtifact;
}

/** Stub — records stage pass metadata until render worker is connected. */
export const createStageRenderPassStub = (clipId: string): StageRenderPassResult => ({
  passId: `stage-pass-${clipId}-${Date.now().toString(36)}`,
  clipId,
  createdAt: new Date().toISOString(),
  artifacts: {
    backgroundRgb: `artifacts/${clipId}/background_rgb.exr`,
    depth: `artifacts/${clipId}/depth.exr`,
    mask: `artifacts/${clipId}/mask.png`,
  },
});
