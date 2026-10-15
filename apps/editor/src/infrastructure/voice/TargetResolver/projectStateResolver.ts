import type { TargetResolver, TargetResolverContext, ResolvedTarget } from "../../../application/ports/TargetResolver";
import type { Project } from "../../../domain/project/types";

const scoreMatch = (needle: string, hay: string): number => {
  const a = needle.trim().toLowerCase();
  const b = hay.trim().toLowerCase();
  if (a === b) return 1;
  if (b.includes(a)) return Math.min(0.95, a.length / Math.max(3, b.length) + 0.2);
  // fuzzy: consecutive chars
  let i = 0;
  for (const ch of a) {
    const idx = b.indexOf(ch, i);
    if (idx < 0) return 0;
    i = idx + 1;
  }
  return Math.min(0.8, a.length / Math.max(3, b.length) + 0.1);
};

export const projectStateResolver = (project: Project): TargetResolver => {
  return {
    resolve(refText: string, context: TargetResolverContext): ResolvedTarget[] {
      const results: ResolvedTarget[] = [];
      const needle = refText.trim().toLowerCase();
      const worldIds = Object.values(project.clips).map((clip) => clip.linkedWorldId).filter(Boolean) as string[];
      const worlds = worldIds.map((id) => project.worlds[id]).filter(Boolean);
      const seen = new Set<string>();
      // If pronoun-like target, prefer current selection
      if (["it", "that", "this", "그거", "이거"].includes(needle) && context.selectionIds?.length) {
        context.selectionIds.forEach((id) => {
          const element =
            worlds.flatMap((w) => w?.elements ?? []).find((e) => e.id === id);
          if (!element) return;
          if (seen.has(element.id)) return;
          seen.add(element.id);
          results.push({
            assetId: element.id,
            kind: element.kind === "actor_mark" ? "character" : element.kind === "light_socket" ? "light" : "prop",
            displayName: element.name,
            score: 0.99,
          });
        });
      }
      // By name (basic; World lane will replace this)
      for (const world of worlds) {
        for (const element of world?.elements ?? []) {
          if (seen.has(element.id)) continue;
          const s = scoreMatch(needle, element.name);
          if (s > 0) {
            seen.add(element.id);
            results.push({
              assetId: element.id,
              kind: element.kind === "actor_mark" ? "character" : element.kind === "light_socket" ? "light" : "prop",
              displayName: element.name,
              score: s,
            });
          }
        }
      }
      // Sorted descending
      return results.sort((a, b) => b.score - a.score);
    },
  };
};

