import { describe, it, expect } from "vitest";
import { listWorldLibrary, filterWorldLibrary } from "./library";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "./sampleWorlds";

describe("World Library listing and filtering", () => {
  const mesh = createMeshExampleWorld();
  const splat = createSplatExampleWorld();
  const points = createPointCloudExampleWorld();
  const worlds = {
    [mesh.id]: mesh,
    [splat.id]: splat,
    [points.id]: points,
  };

  it("lists worlds sorted by updatedAt desc", () => {
    const items = listWorldLibrary(worlds);
    expect(items.map((i) => i.id)).toContain(mesh.id);
    expect(items.map((i) => i.id)).toContain(splat.id);
    expect(items.map((i) => i.id)).toContain(points.id);
  });

  it("filters by representation", () => {
    const items = listWorldLibrary(worlds);
    const onlySplat = filterWorldLibrary(items, { representation: "gaussian_splat" });
    expect(onlySplat.length).toBe(1);
    expect(onlySplat[0].id).toBe(splat.id);
  });

  it("filters by tags", () => {
    const items = listWorldLibrary(worlds);
    const tagged = filterWorldLibrary(items, { tags: ["interior"] });
    expect(tagged.length).toBe(3);
    const none = filterWorldLibrary(items, { tags: ["exterior"] });
    expect(none.length).toBe(0);
  });

  it("searches by name/id/tags", () => {
    const items = listWorldLibrary(worlds);
    expect(filterWorldLibrary(items, { query: "apartment" }).map((i) => i.id)).toEqual([mesh.id]);
    // 'splat' appears in points world description too; disambiguate by representation
    expect(
      filterWorldLibrary(items, { query: "splat", representation: "gaussian_splat" }).map((i) => i.id),
    ).toEqual([splat.id]);
    expect(
      filterWorldLibrary(items, { query: "points", representation: "point_cloud" }).map((i) => i.id),
    ).toEqual([points.id]);
    expect(filterWorldLibrary(items, { query: "gaussian" }).map((i) => i.id)).toEqual([splat.id]);
  });
});

