/** Records a generative model run for reproducibility (PRD §3.2, §12.5). */
export interface ModelExecutionRecord {
  id: string;
  connectorId: string;
  task: string;
  modelVersion?: string;
  seed?: number;
  inputAssetIds: string[];
  outputAssetIds: string[];
  parameters: Record<string, unknown>;
  conditionSummary?: string[];
  startedAt: string;
  completedAt?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  errorMessage?: string;
}
