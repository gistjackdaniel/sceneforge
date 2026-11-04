import { describe, expect, it } from "vitest";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "../sampleWorlds";
import { createWorldTargetResolver, type TargetResolver } from "../query";
import { resolveWorldAssetId } from "./resolveTarget";

const worldsById = () => {
  const apartment = createMeshExampleWorld();
  apartment.localizedNames = { ko: "아파트 거실", en: "Apartment Livingroom" };
  apartment.aliases = ["거실", "living room"];
  const splat = createSplatExampleWorld();
  const points = createPointCloudExampleWorld();
  return {
    apartment,
    splat,
    points,
    worlds: {
      [apartment.id]: apartment,
      [splat.id]: splat,
      [points.id]: points,
    },
  };
};

describe("resolveWorldAssetId", () => {
  it("returns an exact WorldAsset.id without asking TargetResolver", () => {
    const { splat, worlds } = worldsById();
    const resolver: TargetResolver = {
      resolve: () => {
        throw new Error("resolver should not run for an exact id");
      },
    };
    expect(resolveWorldAssetId(splat.id, { worlds, resolver })).toBe(splat.id);
  });

  it("resolves a Korean alias through createWorldTargetResolver", () => {
    const { apartment, worlds } = worldsById();
    const resolver = createWorldTargetResolver(worlds);
    expect(
      resolveWorldAssetId("거실", {
        worlds,
        resolver,
        resolveContext: { selectionIds: [], locale: "ko" },
      }),
    ).toBe(apartment.id);
  });

  it("uses selectionIds from the resolver contract to break a tie", () => {
    const { points, worlds } = worldsById();
    expect(
      resolveWorldAssetId("Color Block", {
        worlds,
        resolveContext: { selectionIds: [points.id], locale: "en" },
      }),
    ).toBe(points.id);
  });

  it("picks the highest score when the resolver list is unsorted", () => {
    const { apartment, splat, worlds } = worldsById();
    const resolver: TargetResolver = {
      resolve: () => [
        { assetId: splat.id, kind: "location", displayName: splat.name, score: 40 },
        { assetId: apartment.id, kind: "location", displayName: apartment.name, score: 90 },
      ],
    };
    expect(resolveWorldAssetId("not-an-id", { worlds, resolver })).toBe(apartment.id);
  });

  it("throws when the top score points at more than one world", () => {
    const { splat, points } = worldsById();
    const worlds = { [splat.id]: splat, [points.id]: points };
    expect(() =>
      resolveWorldAssetId("Color Block", {
        worlds,
        resolveContext: { selectionIds: [], locale: "en" },
      }),
    ).toThrow(/ambiguous/i);
  });

  it("throws when nothing matches", () => {
    const { worlds } = worldsById();
    expect(() => resolveWorldAssetId("missing-world", { worlds })).toThrow(/could not be resolved/i);
  });

  it("rejects a resolver hit that is not a WorldAsset.id in the given set", () => {
    const { worlds } = worldsById();
    const resolver: TargetResolver = {
      resolve: () => [{ assetId: "not-a-world", kind: "location", displayName: "nope", score: 100 }],
    };
    expect(() => resolveWorldAssetId("거실", { worlds, resolver })).toThrow(/WorldAsset\.id/);
  });
});
