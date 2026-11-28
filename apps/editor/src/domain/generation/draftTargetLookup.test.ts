import { describe, expect, it } from "vitest";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "../worlds/sampleWorlds";
import { DraftTargetLookup } from "./draftTargetLookup";

describe("DraftTargetLookup", () => {
  it("resolves a Korean alias only through TargetResolver", () => {
    const world = createMeshExampleWorld();
    world.localizedNames = { ko: "아파트 거실", en: "Apartment Livingroom" };
    world.aliases = ["living room", "거실"];
    const worlds = { [world.id]: world };

    const hits = DraftTargetLookup.resolve(worlds, "거실", { selectionIds: [], locale: "ko" });
    expect(hits[0]?.assetId).toBe(world.id);
    expect(hits[0]?.kind).toBe("location");
    expect(hits[0]?.displayName).toContain("아파트");

    const resolution = DraftTargetLookup.resolvePrompt(worlds, "Walk toward @거실", {
      selectionIds: [],
      locale: "ko",
    });
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.ambiguous).toEqual([]);
    expect(resolution.accepted.map((item) => item.assetId)).toEqual([world.id]);
  });

  it("leaves tied world names unresolved as ambiguous", () => {
    const splat = createSplatExampleWorld();
    const points = createPointCloudExampleWorld();
    const worlds = { [splat.id]: splat, [points.id]: points };
    const resolution = DraftTargetLookup.resolvePrompt(worlds, "@[Color Block]", {
      selectionIds: [],
      locale: "en",
    });
    expect(resolution.accepted).toEqual([]);
    expect(resolution.ambiguous).toEqual(["Color Block"]);
  });

  it("returns no matches for an unknown mention", () => {
    const world = createMeshExampleWorld();
    const resolution = DraftTargetLookup.resolvePrompt({ [world.id]: world }, "@없는대상", {
      selectionIds: [],
      locale: "ko",
    });
    expect(resolution.accepted).toEqual([]);
    expect(resolution.unresolved).toEqual(["없는대상"]);
  });
});
