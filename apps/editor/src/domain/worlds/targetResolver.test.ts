import { describe, it, expect } from "vitest";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "./sampleWorlds";
import { createWorldQueryIndex, createWorldTargetResolver, type TargetMatch } from "./query";

const byId = <T extends { assetId: string }>(arr: T[], id: string): T | undefined => arr.find((r) => r.assetId === id);

describe("World target resolver and query index", () => {
  const fixtureWorlds = () => {
    const w1 = createMeshExampleWorld();
    const w2 = createSplatExampleWorld();
    const w3 = createPointCloudExampleWorld();
    // Optional localized names and aliases (backward compatible)
    w1.localizedNames = { ko: "아파트 거실", en: "Apartment Livingroom" };
    w1.aliases = ["living room", "거실"];
    return { w1, w2, w3, worlds: { [w1.id]: w1, [w2.id]: w2, [w3.id]: w3 } };
  };

  it("looks up a world by id", () => {
    const { w1, worlds } = fixtureWorlds();
    const index = createWorldQueryIndex(worlds);
    expect(index.getWorldById(w1.id)?.id).toBe(w1.id);
  });

  it("resolves by name/alias/tag including Korean localized names", () => {
    const { w1, worlds } = fixtureWorlds();
    const resolver = createWorldTargetResolver(worlds);
    const results = resolver.resolve("거실", { selectionIds: [], locale: "ko" });
    const hit = byId(results, w1.id);
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("location");
    expect(hit?.displayName).toContain("아파트");
  });

  it("supports kind filtering and prop lookup", () => {
    const { w1, worlds } = fixtureWorlds();
    const resolver = createWorldTargetResolver(worlds);
    const results = resolver.resolve("cube prop", { selectionIds: [], locale: "en" });
    // Expect a prop result within the apartment world
    const propHit = results.find((r) => r.assetId === w1.id && r.kind === "prop");
    expect(propHit).toBeDefined();
  });

  it("returns multiple candidates on ambiguous references and boosts by selectionIds", () => {
    const { w2, w3, worlds } = fixtureWorlds();
    const resolver = createWorldTargetResolver(worlds);
    const results = resolver.resolve("Color Block", { selectionIds: [], locale: "en" });
    const a = byId(results, w2.id);
    const b = byId(results, w3.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // With selection boost, prefer the selected one
    const boosted = resolver.resolve("Color Block", { selectionIds: [w3.id], locale: "en" });
    expect(boosted[0]?.assetId).toBe(w3.id);
  });

  it("returns empty when no candidates match", () => {
    const { worlds } = fixtureWorlds();
    const resolver = createWorldTargetResolver(worlds);
    const results = resolver.resolve("nonexistent qwerty", { selectionIds: [], locale: "en" });
    expect(results.length).toBe(0);
  });
});

