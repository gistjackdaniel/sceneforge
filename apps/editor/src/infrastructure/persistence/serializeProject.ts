import type { Project } from "../../domain/project/types";
import { projectEnvelopeSchema } from "./projectSchema";

export const CURRENT_ENVELOPE_VERSION = 2 as const;

export interface ProjectEnvelopeV2 {
  version: typeof CURRENT_ENVELOPE_VERSION;
  project: Project;
}

export class ProjectPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPersistenceError";
  }
}

export const serializeProject = (project: Project): string =>
  JSON.stringify(
    {
      version: CURRENT_ENVELOPE_VERSION,
      project,
    } satisfies ProjectEnvelopeV2,
    null,
    2,
  );

/**
 * Parse and validate a project envelope (v1 or v2).
 * Does not run domain migrate — caller should call migrateProject afterwards.
 */
export const deserializeProject = (raw: string): Project => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProjectPersistenceError("Project data is not valid JSON.");
  }

  const parsed = projectEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProjectPersistenceError("Project schema validation failed.");
  }

  const project = parsed.data.project as unknown as Project;
  return {
    ...project,
    assets: project.assets ?? {},
  };
};
