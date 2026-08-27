import { migrateProject as domainMigrate } from "../../domain/project/migrate";
import type { Project } from "../../domain/project/types";
import { buildDependencyMap } from "../../core/clipgraph/dependency";
import { syncClipCacheFields } from "../../core/project/clipCacheStatus";
import {
  deserializeProject,
  serializeProject,
  writeAtomicLocalStorage,
} from "../../infrastructure/persistence";

export const loadAndMigrateProject = (raw: string): Project => {
  const project = deserializeProject(raw);
  return domainMigrate(project, { buildDependencyMap, syncClipCacheFields });
};

export const saveProjectAtomically = (storageKey: string, project: Project): void => {
  writeAtomicLocalStorage(storageKey, serializeProject(project));
};

export const migrateLoadedProject = (project: Project): Project =>
  domainMigrate(project, { buildDependencyMap, syncClipCacheFields });
