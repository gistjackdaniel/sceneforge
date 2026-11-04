import type { WorldAsset, WorldRepresentation } from "./types";

export interface WorldLibraryFilters {
  query?: string;
  representation?: WorldRepresentation | "all";
  tags?: string[];
}

export interface WorldLibraryItem {
  id: string;
  world: WorldAsset;
}

export const listWorldLibrary = (worlds: Record<string, WorldAsset>): WorldLibraryItem[] => {
  return Object.values(worlds)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((world) => ({ id: world.id, world }));
};

export const filterWorldLibrary = (
  items: WorldLibraryItem[],
  filters: WorldLibraryFilters,
): WorldLibraryItem[] => {
  const query = (filters.query ?? "").trim().toLowerCase();
  const rep = filters.representation ?? "all";
  const tagSet = new Set((filters.tags ?? []).map((t) => t.toLowerCase()).filter(Boolean));

  return items.filter(({ world }) => {
    if (rep !== "all" && world.representation !== rep) {
      return false;
    }
    if (tagSet.size > 0) {
      const worldTags = (world.semanticTags ?? []).map((t) => t.toLowerCase());
      for (const tag of tagSet) {
        if (!worldTags.includes(tag)) {
          return false;
        }
      }
    }
    if (!query) {
      return true;
    }
    const hay = [
      world.id.toLowerCase(),
      world.name.toLowerCase(),
      (world.description ?? "").toLowerCase(),
      ...(world.semanticTags ?? []).map((t) => t.toLowerCase()),
    ].join(" ");
    return hay.includes(query);
  });
};

