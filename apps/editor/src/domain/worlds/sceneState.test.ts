import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerWorldFromLyraOutput } from "../../core/world/artifactRegistry";
import { deserializeWorldElements, deserializeWorldInstances, serializeWorldInstances } from "../../core/world/storage";
import {
  applyImportTransform,
  buildImportTransform,
  sourceAxesFromWorldAsset,
  sourceAxesSchema,
} from "./coordinates";
import { WorldDomainError } from "./errors";
import { createPersistentIdFactory, legacyActorInstanceId, legacyPropInstanceId, newIdSchema, persistentIdSchema } from "./ids";
import {
  adoptRegeneratedWorld,
  instanceIdForLegacyElement,
  instanceIdsForLegacyProp,
  migrateWorldToSceneState,
} from "./migrateInstances";
import { normalizeWorldAsset } from "./normalize";
import { temporaryCanonicalize, temporaryPreservationCheck, type ShotStateReader } from "./preservation";
import {
  appendAssetRevision,
  cloneInstance,
  deleteInstance,
  pinInstanceRevision,
  renameInstance,
  resolveRigPart,
  restoreInstance,
  retargetInstanceAsset,
  sceneStateSchema,
} from "./sceneState";
import { createMeshExampleWorld } from "./sampleWorlds";
import type { WorldAsset, WorldElement } from "./types";

const zeroBytes = (): Uint8Array => new Uint8Array(10);

const readerOf = (scene: ReturnType<typeof migrateWorldToSceneState>): ShotStateReader => ({
  scene,
  cameraSamples: () => [],
  actorPoseFrames: () => [],
  contact: () => undefined,
});

const lyraOutput = (mesh: string, jobId: string) => ({
  jobId,
  generatedSegmentPath: `${mesh}/seg`,
  spatialMemoryPath: `${mesh}/mem`,
  visualLayer3dgsPath: `${mesh}/vis`,
  surfaceMeshPath: mesh,
  memoryCoverage: 0.4,
  generatedAreaRatio: 0.5,
});

const lyraInput = (world: WorldAsset, jobId: string) => ({
  worldId: world.id,
  name: world.name,
  description: world.description,
  jobId,
  nodeIds: {
    sourceImageNodeId: "n-source",
    worldGenerateNodeId: "n-world",
    generatedSegmentNodeId: "n-seg",
    spatialMemoryNodeId: "n-mem",
  },
});

describe("persistent ids", () => {
  it("mints prefix plus a 26-character Crockford body and keeps lexical time order", () => {
    const early = createPersistentIdFactory({ now: () => 0, randomBytes: zeroBytes });
    const later = createPersistentIdFactory({ now: () => 1, randomBytes: zeroBytes });
    const first = early.mint("act");
    expect(first).toBe(`act_${"0".repeat(26)}`);
    expect(first < later.mint("act")).toBe(true);
    const sameMillisecond = createPersistentIdFactory({ now: () => 50, randomBytes: zeroBytes });
    const left = sameMillisecond.mint("obj");
    const right = sameMillisecond.mint("obj");
    expect(left < right).toBe(true);
    expect(left).toMatch(/^obj_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newIdSchema("obj").safeParse(left).success).toBe(true);
  });

  it("does not mint a reserved id again", () => {
    const first = createPersistentIdFactory({ now: () => 0, randomBytes: zeroBytes }).mint("act");
    const blocked = createPersistentIdFactory({
      now: () => 0,
      randomBytes: zeroBytes,
      reserved: [first],
    });
    expect(blocked.mint("act")).not.toBe(first);
    expect(persistentIdSchema.safeParse("elem-actor-mark-a").success).toBe(true);
    expect(persistentIdSchema.safeParse("world-apartment-livingroom").success).toBe(true);
    expect(persistentIdSchema.safeParse("1nope").success).toBe(false);
  });
});

describe("coordinate contract", () => {
  it("records handedness and front axis from the existing world fields", () => {
    const yUp = normalizeWorldAsset({ id: "world-y", name: "Y", unitScaleMeters: 1 });
    expect(yUp.coordinateSystem).toBe("Y_UP");
    expect(yUp.handedness).toBe("right");
    expect(yUp.frontAxis).toBe("+Z");
    const yAxes = sourceAxesFromWorldAsset(yUp);
    expect(yAxes.upAxis).toBe("Y");
    expect(yAxes.metersPerUnit).toBe(1);
    expect(applyImportTransform(yAxes.importTransform!, [1, 2, 3])).toEqual([1, 2, 3]);

    const zUp = normalizeWorldAsset({
      id: "world-z",
      name: "Z",
      coordinateSystem: "Z_UP",
      unitScaleMeters: 0.01,
    });
    expect(zUp.frontAxis).toBe("-Y");
    const zAxes = sourceAxesFromWorldAsset(zUp);
    expect(zAxes.upAxis).toBe("Z");
    expect(zAxes.metersPerUnit).toBe(0.01);
    const forward = applyImportTransform(zAxes.importTransform!, [0, -100, 0]);
    const up = applyImportTransform(zAxes.importTransform!, [0, 0, 100]);
    const right = applyImportTransform(zAxes.importTransform!, [100, 0, 0]);
    expect(forward[2]).toBeCloseTo(1);
    expect(forward[0]).toBeCloseTo(0);
    expect(up[1]).toBeCloseTo(1);
    expect(right[0]).toBeCloseTo(1);
  });

  it("mirrors a left-handed source and rejects a front axis parallel to up", () => {
    const left = buildImportTransform({ upAxis: "Y", handedness: "left", frontAxis: "+Z", metersPerUnit: 1 });
    expect(applyImportTransform(left, [1, 2, 3])[0]).toBeCloseTo(-1);
    expect(applyImportTransform(left, [1, 2, 3])[1]).toBeCloseTo(2);
    expect(() =>
      buildImportTransform({ upAxis: "Z", handedness: "right", frontAxis: "+Z", metersPerUnit: 1 }),
    ).toThrow(WorldDomainError);
    expect(sourceAxesSchema.safeParse({ upAxis: "Z", frontAxis: "+Z", metersPerUnit: 1 }).success).toBe(false);
  });
});

describe("legacy instance migration", () => {
  const element = (id: string, name: string, kind: WorldElement["kind"]): WorldElement => ({
    id,
    name,
    kind,
    description: "",
  });

  const world = () =>
    normalizeWorldAsset({
      id: "world-props",
      name: "Props",
      props: ["cup", "cup"],
      elements: [
        element("elem-room", "Room", "room"),
        element("elem-light", "Light", "light_socket"),
        element("elem-socket", "Socket", "socket"),
        element("elem-actor-mark-a", "A", "actor_mark"),
      ],
    });

  it("is idempotent and keeps world and element ids", () => {
    const source = world();
    const elementIds = source.elements.map((item) => item.id);
    const first = migrateWorldToSceneState(source);
    const second = migrateWorldToSceneState(source);
    expect(temporaryCanonicalize(first)).toBe(temporaryCanonicalize(second));
    expect(source.id).toBe("world-props");
    expect(source.elements.map((item) => item.id)).toEqual(elementIds);
    expect(first.worldId).toBe(source.id);
    expect(first.assets["asset-world-props"]?.kind).toBe("world");
    expect(first.setAssetRef.assetId).toBe("asset-world-props");
  });

  it("instances actor marks, sockets, and prop names without promoting rooms or lights", () => {
    const source = world();
    const scene = migrateWorldToSceneState(source);
    const actorId = legacyActorInstanceId(source.id, "elem-actor-mark-a");
    expect(scene.actors[actorId]?.label).toBe("A");
    expect(scene.actors[actorId]?.skeleton.betas).toHaveLength(10);
    expect(scene.actors[actorId]?.legacyRefs).toEqual([
      { kind: "world_element", worldId: source.id, elementId: "elem-actor-mark-a" },
    ]);
    expect(instanceIdForLegacyElement(scene, source.id, "elem-actor-mark-a")).toBe(actorId);
    expect(instanceIdForLegacyElement(scene, source.id, "elem-room")).toBeUndefined();
    expect(instanceIdForLegacyElement(scene, source.id, "elem-light")).toBeUndefined();
    expect(instanceIdForLegacyElement(scene, source.id, "elem-socket")).toBe(
      `obj_legacy_world_props__elem_socket`,
    );
    const propIds = instanceIdsForLegacyProp(scene, source.id, "cup");
    expect(propIds).toEqual([
      legacyPropInstanceId(source.id, "cup", 1),
      legacyPropInstanceId(source.id, "cup", 2),
    ]);
    expect(scene.objects[propIds[0]!]!.assetRef).toEqual(scene.objects[propIds[1]!]!.assetRef);
    expect(Object.values(scene.actors)).toHaveLength(1);
    expect(Object.values(scene.objects)).toHaveLength(3);
  });

  it("keeps instance ids when a world regeneration appends a revision", () => {
    const base = createMeshExampleWorld();
    const once = registerWorldFromLyraOutput(lyraInput(base, "job-1"), lyraOutput("mesh-v1", "job-1"), base);
    const scene = migrateWorldToSceneState(once);
    const twice = registerWorldFromLyraOutput(lyraInput(once, "job-2"), lyraOutput("mesh-v2", "job-2"), once);
    const expanded: WorldAsset = { ...twice, props: [...twice.props, "lamp"] };
    const adopted = adoptRegeneratedWorld(scene, expanded);
    expect(Object.keys(adopted.actors)).toEqual(Object.keys(scene.actors));
    expect(Object.keys(scene.objects).every((id) => adopted.objects[id]?.assetRef.revisionId === scene.objects[id]?.assetRef.revisionId)).toBe(true);
    expect(adopted.setAssetRef).toEqual(scene.setAssetRef);
    const worldAsset = adopted.assets["asset-world-apartment-livingroom"];
    expect(worldAsset?.revisionIds).toHaveLength(2);
    expect(worldAsset?.headRevisionId).not.toBe(scene.assets["asset-world-apartment-livingroom"]?.headRevisionId);
    expect(instanceIdsForLegacyProp(adopted, base.id, "lamp")).toEqual([
      legacyPropInstanceId(base.id, "lamp", 1),
    ]);
    expect(temporaryCanonicalize(adoptRegeneratedWorld(adopted, expanded))).toBe(temporaryCanonicalize(adopted));
  });
});

describe("instance commands", () => {
  const factory = () => createPersistentIdFactory({ now: () => 10, randomBytes: zeroBytes });

  it("keeps the id across rename, revision pin, asset swap, and round-trip", () => {
    const source = createMeshExampleWorld();
    const scene = migrateWorldToSceneState(source);
    const actorId = instanceIdForLegacyElement(scene, source.id, "elem-actor-mark-a");
    expect(actorId).toBeDefined();
    const renamed = renameInstance(scene, actorId!, { label: "Lead" });
    expect(renamed.actors[actorId!]?.id).toBe(actorId);
    expect(renamed.actors[actorId!]?.label).toBe("Lead");
    const identity = temporaryPreservationCheck.check(readerOf(scene), readerOf(renamed), [], []);
    expect(identity.every((row) => row.ok)).toBe(true);

    const actor = renamed.actors[actorId!]!;
    const current = renamed.revisions[actor.assetRef.revisionId]!;
    const revisionId = factory().mint("rev");
    const appended = appendAssetRevision(renamed, {
      ...current,
      revisionId,
      revision: current.revision + 1,
      parentRevisionId: current.revisionId,
      contentHash: "legacy-fingerprint:character-v2",
      uri: "placeholder://smplx/neutral-v2",
      createdAt: "2026-11-04T01:00:00.000Z",
    });
    expect(appended.revisions[current.revisionId]).toEqual(current);
    expect(() => appendAssetRevision(appended, appended.revisions[revisionId]!)).toThrow(WorldDomainError);
    const pinned = pinInstanceRevision(appended, actorId!, revisionId);
    expect(pinned.actors[actorId!]?.id).toBe(actorId);
    expect(pinned.actors[actorId!]?.assetRef.revisionId).toBe(revisionId);

    const worldRevision = pinned.revisions[pinned.setAssetRef.revisionId]!;
    const retargeted = retargetInstanceAsset(pinned, actorId!, {
      assetId: worldRevision.assetId,
      revisionId: worldRevision.revisionId,
    });
    expect(retargeted.actors[actorId!]?.id).toBe(actorId);
    expect(retargeted.actors[actorId!]?.assetRef.assetId).toBe(worldRevision.assetId);

    const raw = serializeWorldInstances({ schemaVersion: 1, worldId: retargeted.worldId, scene: retargeted });
    expect(deserializeWorldInstances(raw).scene.actors[actorId!]?.assetRef).toEqual(
      retargeted.actors[actorId!]?.assetRef,
    );
  });

  it("gives a clone a new id and never reuses a tombstone", () => {
    const source = createMeshExampleWorld();
    const scene = migrateWorldToSceneState(source);
    const actorId = instanceIdForLegacyElement(scene, source.id, "elem-actor-mark-a")!;
    const ids = factory();
    const cloneId = ids.mint("act");
    const cloned = cloneInstance(scene, actorId, cloneId, "A copy");
    expect(cloned.actors[cloneId]?.clonedFrom).toBe(actorId);
    expect(cloned.actors[actorId]?.id).toBe(actorId);
    const tombstoned = deleteInstance(cloned, cloneId, "2026-11-04T02:00:00.000Z");
    expect(tombstoned.actors[cloneId]?.deletedAt).toBe("2026-11-04T02:00:00.000Z");
    expect(deleteInstance(tombstoned, cloneId, "2026-11-04T03:00:00.000Z").actors[cloneId]?.deletedAt).toBe(
      "2026-11-04T02:00:00.000Z",
    );
    expect(() => cloneInstance(tombstoned, actorId, cloneId, "again")).toThrow(WorldDomainError);
    try {
      cloneInstance(tombstoned, actorId, cloneId, "again");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldDomainError);
      expect((error as WorldDomainError).code).toBe("id_reused");
    }
    expect(restoreInstance(tombstoned, cloneId).actors[cloneId]?.deletedAt).toBeUndefined();
  });
});

describe("attachment and package boundaries", () => {
  it("resolves rig part names and rejects an actor attachment without one", () => {
    expect(resolveRigPart("오른손")).toEqual({ rigPart: "right_hand", joint: "right_wrist" });
    expect(resolveRigPart("left hand")).toEqual({ rigPart: "left_hand", joint: "left_wrist" });
    expect(resolveRigPart("손")).toBeUndefined();
    const source = createMeshExampleWorld();
    const scene = migrateWorldToSceneState(source);
    const actorId = instanceIdForLegacyElement(scene, source.id, "elem-actor-mark-a")!;
    const cupId = instanceIdsForLegacyProp(scene, source.id, "cube")[0]!;
    const broken = {
      ...scene,
      objects: {
        ...scene.objects,
        [cupId]: {
          ...scene.objects[cupId],
          attachments: [{ parentInstanceId: actorId, offset: scene.objects[cupId]!.restTransform }],
        },
      },
    };
    const parsed = sceneStateSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("rigPart"))).toBe(true);
    }
    const self = {
      ...scene,
      objects: {
        ...scene.objects,
        [cupId]: {
          ...scene.objects[cupId],
          attachments: [{ parentInstanceId: cupId, offset: scene.objects[cupId]!.restTransform }],
        },
      },
    };
    expect(sceneStateSchema.safeParse(self).success).toBe(false);
    expect(sceneStateSchema.safeParse({
      ...scene,
      actors: {
        ...scene.actors,
        [actorId]: {
          ...scene.actors[actorId],
          restTransform: { translation: [0, 0, 0], rotation: [2, 0, 0, 0], scale: [1, 1, 1] },
        },
      },
    }).success).toBe(false);
  });

  it("validates elements.json and keeps instances in their own package", () => {
    const raw = readFileSync(
      fileURLToPath(new URL("../../../public/worlds/apartment_livingroom/elements.json", import.meta.url)),
      "utf8",
    );
    const elements = deserializeWorldElements(raw);
    expect(elements.version).toBe(1);
    expect(elements.elements.map((element) => element.id)).toContain("elem-actor-mark-a");
    expect(() =>
      deserializeWorldElements(JSON.stringify({
        version: 1,
        worldId: "world-1",
        elements: [{ id: "e", name: "n", kind: "not-a-kind", description: "" }],
      })),
    ).toThrow("Invalid world elements payload.");
    const scene = migrateWorldToSceneState(createMeshExampleWorld());
    expect(() =>
      deserializeWorldInstances(JSON.stringify({ schemaVersion: 1, worldId: "world-other", scene })),
    ).toThrow("Invalid world instances payload.");
  });
});
