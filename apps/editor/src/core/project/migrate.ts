import { migrateProject as domainMigrate } from "../../domain/project/migrate";
import type { Project } from "../../domain/project/types";
import { buildDependencyMap } from "../clipgraph/dependency";
import { syncClipCacheFields } from "./clipCacheStatus";

/** Normalize legacy persisted project data to current spec-aligned shapes. */
export const migrateProject = (project: Project): Project =>
  domainMigrate(project, { buildDependencyMap, syncClipCacheFields });
