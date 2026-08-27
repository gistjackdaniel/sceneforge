export interface GenerativeRefinementResult {
  refinementId: string;
  clipId: string;
  status: "stub" | "completed" | "failed";
  outputPath?: string;
}

/** Connector stub for GenerativeRefinementNode (P2-A). */
export const runGenerativeRefinementStub = (clipId: string): GenerativeRefinementResult => ({
  refinementId: `refine-${clipId}-${Date.now().toString(36)}`,
  clipId,
  status: "stub",
  outputPath: `artifacts/${clipId}/refinement_stub.mp4`,
});
