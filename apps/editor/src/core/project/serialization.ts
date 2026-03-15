import type { Project } from "./types";

export interface ProjectEnvelope {
  version: 1;
  project: Project;
}

export const serializeProject = (project: Project): string =>
  JSON.stringify(
    {
      version: 1,
      project,
    } satisfies ProjectEnvelope,
    null,
    2,
  );

export const deserializeProject = (raw: string): Project => {
  const parsed = JSON.parse(raw) as ProjectEnvelope;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported project envelope version: ${String(parsed.version)}`);
  }
  return parsed.project;
};
