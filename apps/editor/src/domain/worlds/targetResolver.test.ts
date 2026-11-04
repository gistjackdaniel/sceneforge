import { describe, it, expect } from "vitest";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "./sampleWorlds";
import { createWorldQueryIndex, createWorldTargetResolver, type TargetMatch } from "./query";
import { deleteInstance } from "./sceneState";
import { instanceIdForLegacyElement, migrateWorldToSceneState } from "./migrateInstances";
import { normalizeWorldAsset } from "./normalize";
import type { WorldElement } from "./types";

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

  it("distinguishes actor A from actor B inside one world", () => {
    const mark = (id: string, name: string): WorldElement => ({
      id,
      name,
      kind: "actor_mark",
      description: "",
      aliases: ["person"],
    });
    const world = normalizeWorldAsset({
      id: "world-apartment-livingroom",
      name: "Apartment Livingroom",
      localizedNames: { ko: "아파트 거실", en: "Apartment Livingroom" },
      aliases: ["living room", "거실"],
      elements: [mark("elem-a", "A"), mark("elem-b", "B")],
      props: ["컵"],
    });
    const scene = migrateWorldToSceneState(world);
    const resolver = createWorldTargetResolver({ [world.id]: world }, { [world.id]: scene });
    const actorA = resolver.resolve("A", { selectionIds: [], locale: "ko" }).find((match) => match.instanceId);
    const actorB = resolver.resolve("B", { selectionIds: [], locale: "ko" }).find((match) => match.instanceId);
    expect(actorA?.instanceId).toBe(instanceIdForLegacyElement(scene, world.id, "elem-a"));
    expect(actorB?.instanceId).toBe(instanceIdForLegacyElement(scene, world.id, "elem-b"));
    expect(actorA?.instanceId).not.toBe(actorB?.instanceId);
    expect(actorA?.assetId).toBe(world.id);
    expect(actorB?.assetId).toBe(world.id);
    const elementA = resolver.resolve("A", { selectionIds: [], locale: "en" }).find((match) => match.elementId);
    expect(elementA?.elementId).toBe("elem-a");
    expect(elementA?.instanceId).toBeUndefined();
    expect(elementA?.assetId).toBe(world.id);

    const cup = resolver.resolve("컵", { selectionIds: [], locale: "ko" }).find((match) => match.instanceId);
    expect(cup?.kind).toBe("prop");
    expect(cup?.assetId).toBe(world.id);

    const removed = deleteInstance(scene, actorB!.instanceId!, "2026-11-04T00:00:00.000Z");
    const afterDelete = createWorldTargetResolver({ [world.id]: world }, { [world.id]: removed });
    expect(afterDelete.resolve("B", { selectionIds: [], locale: "ko" }).some((match) => match.instanceId)).toBe(false);
    expect(afterDelete.resolve("B", { selectionIds: [], locale: "ko" }).some((match) => match.elementId === "elem-b")).toBe(true);

    const boosted = resolver.resolve("person", { selectionIds: [actorA!.instanceId!], locale: "en" });
    expect(boosted[0]?.instanceId).toBe(actorA?.instanceId);

    const livingRoom = resolver.resolve("거실", { selectionIds: [], locale: "ko" });
    expect(livingRoom[0]?.assetId).toBe(world.id);
    expect(livingRoom[0]?.kind).toBe("location");
  });
});

