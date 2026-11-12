import { describe, expect, it } from "vitest";
import type { Project } from "../../domain/project/types";
import { parseShot, resolveShotContacts, shotId, subjectForActorRef, subjectId, type Shot } from "../../domain/shot";
import { instanceIdForLegacyElement, migrateWorldToSceneState } from "../../domain/worlds/migrateInstances";
import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import { createWorldTargetResolver } from "../../domain/worlds/query";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "./bus";
import type { DomainCommand } from "./types";

const now = "2026-11-12T00:00:00.000Z";

const placement = (x: number) => ({
  position: [x, 0, 0] as [number, number, number],
  rotationEuler: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

const rootMotion = (x: number) => ({
  channel: "explicit" as const,
  interpolation: "linear" as const,
  keys: [{ frame: 0, ...placement(x) }],
  provenance: { kind: "keyed" as const },
});

const world = normalizeWorldAsset({
  id: "world-room",
  name: "Room",
  elements: [
    { id: "elem-room", name: "Room", kind: "room", description: "" },
    { id: "elem-a", name: "A", kind: "actor_mark", description: "" },
    { id: "elem-b", name: "B", kind: "actor_mark", description: "" },
  ],
  props: ["Table"],
});
const scene = migrateWorldToSceneState(world);
const actorA = instanceIdForLegacyElement(scene, world.id, "elem-a");
const actorB = instanceIdForLegacyElement(scene, world.id, "elem-b");
if (!actorA || !actorB) throw new Error("Room fixture is missing actor instances.");

const baseShot = (): Shot => {
  const pins = [
    { assetId: "asset-actor-a", revisionId: "asset-actor-a@2" },
    { assetId: "asset-actor-b", revisionId: "asset-actor-b@3" },
    { assetId: "asset-table", revisionId: "asset-table@1" },
  ];
  return parseShot({
    schemaVersion: 1,
    id: "clip-room",
    name: "Handshake",
    time: { fps: 24, durationFrames: 48, origin: "clip_local" },
    subjects: [
      {
        id: actorA,
        assetId: "asset-actor-a",
        assetVersion: 2,
        name: "A",
        uri: "asset:actor-a",
        placement: placement(0),
        visible: true,
        locked: false,
        kind: "human",
        representation: "mesh",
        motion: rootMotion(1),
      },
      {
        id: actorB,
        assetId: "asset-actor-b",
        assetVersion: 3,
        name: "B",
        uri: "asset:actor-b",
        placement: placement(1),
        visible: true,
        locked: false,
        kind: "human",
        representation: "mesh",
        motion: rootMotion(2),
      },
      {
        id: "obj_table",
        assetId: "asset-table",
        assetVersion: 1,
        name: "Table",
        uri: "asset:table",
        placement: placement(3),
        visible: true,
        locked: false,
        kind: "object",
        representation: "mesh",
        motion: { channel: "unset" },
      },
    ],
    camera: {
      status: "ready",
      lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 },
      interpolation: "linear",
      selectedTakeId: "cam_take",
      takes: [{
        schemaVersion: 1,
        id: "cam_take",
        name: "Take",
        source: "record",
        keys: [{ frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 }],
        createdAt: now,
      }],
    },
    environment: { worldId: world.id },
    renders: [],
    contacts: [{ id: "handshake_01", actorId: actorB, targetActorId: actorA, effector: "left_hand" }],
    overrides: [],
    revisions: [{ id: "shr_base", createdAt: now, overrides: [], assetRefs: pins }],
    headRevisionId: "shr_base",
    approvals: [{ revisionId: "shr_base", status: "pending" }],
  });
};

const projectFor = (shot: Shot): Project => ({
  id: "p",
  name: "P",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq",
  sequences: { seq: { id: "seq", name: "Main", clipIds: [shot.id], playhead: 0, visibleRange: [0, 48], fps: 30 } },
  clips: {
    [shot.id]: {
      id: shot.id,
      name: shot.name,
      start: 0,
      end: 48,
      duration: 48,
      sourceType: "empty",
      linkedWorldId: world.id,
      clipGraphId: "g",
      cacheStatus: "valid",
    },
  },
  clipGraphs: { g: { id: "g", clipId: shot.id, rootNodeId: "n", nodeIds: [], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: { [world.id]: world },
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
  shots: { [shot.id]: shot },
});

const currentShot = (project: Project): Shot => {
  const shot = project.shots?.[shotId("clip-room")];
  if (!shot) throw new Error("Shot missing.");
  return shot;
};

const motionOf = (shot: Shot, index: number) => {
  const subject = shot.subjects[index];
  if (!subject || subject.kind === "light") throw new Error("Expected a posed subject.");
  return subject.motion;
};

describe("shot contact override", () => {
  it("changes B's contact hand and restores the shot by undo and revert", () => {
    const original = baseShot();
    const resolver = createWorldTargetResolver({ [world.id]: world }, { [world.id]: scene });
    const matchesB = resolver.resolve("B", { selectionIds: [], locale: "en" });
    const subjectB = subjectForActorRef(original, matchesB, "B");
    const matchesA = resolver.resolve("A", { selectionIds: [], locale: "en" });
    const subjectA = subjectForActorRef(original, matchesA, "A");
    expect(subjectB?.id).toBe(actorB);
    expect(subjectA?.id).toBe(actorA);

    let project = projectFor(original);
    let bus = emptyCommandBusState();
    const run = (command: DomainCommand) => {
      const executed = executeCommand(project, bus, command, now);
      expect(executed.result.ok).toBe(true);
      project = executed.project;
      bus = executed.bus;
      return currentShot(project);
    };

    const added = run({
      type: "SHOT",
      command: {
        type: "ADD_SHOT_OVERRIDE",
        shotId: original.id,
        contactId: "handshake_01",
        actorSubjectId: subjectId(actorB),
        targetSubjectId: subjectId(actorA),
        newEffector: "오른손",
        preserve: ["camera_track", "actor_a_root_motion", "set_layout"],
        recompute: ["actor_b_motion", "contact"],
      },
    });

    expect(added.camera).toBe(original.camera);
    expect(added.environment).toBe(original.environment);
    expect(added.subjects).toBe(original.subjects);
    expect(motionOf(added, 0)).toBe(motionOf(original, 0));
    expect(motionOf(added, 1)).toBe(motionOf(original, 1));
    expect(added.subjects[2]?.placement).toBe(original.subjects[2]?.placement);
    expect(added.contacts).toBe(original.contacts);
    expect(added.contacts?.[0]?.effector).toBe("left_hand");
    expect(added.approvals).toBe(original.approvals);
    expect(resolveShotContacts(added)[0]?.effector).toBe("right_hand");
    expect(added.revisions?.map((revision) => revision.id)).toEqual(["shr_base", "shr_clip-room_1"]);
    expect(added.revisions?.[1]?.assetRefs).toEqual(original.revisions?.[0]?.assetRefs);
    expect(added.time.fps).toBe(24);

    const undone = undoCommand(project, bus, now);
    expect(undone.result.ok).toBe(true);
    expect(currentShot(undone.project)).toEqual(original);
    project = undone.project;
    bus = undone.bus;

    const redone = redoCommand(project, bus, now);
    expect(redone.result.ok).toBe(true);
    project = redone.project;
    bus = redone.bus;
    const redoneShot = currentShot(project);
    expect(resolveShotContacts(redoneShot)[0]?.effector).toBe("right_hand");
    expect(redoneShot.camera).toEqual(original.camera);
    expect(motionOf(redoneShot, 0)).toEqual(motionOf(original, 0));
    const addRevision = redoneShot.revisions?.[1];
    expect(addRevision?.overrides[0]?.effector).toBe("right_hand");

    const updated = run({
      type: "SHOT",
      command: {
        type: "UPDATE_SHOT_OVERRIDE",
        shotId: original.id,
        eventId: "sev_clip-room_0",
        newEffector: "left_hand",
      },
    });
    expect(updated.camera).toBe(redoneShot.camera);
    expect(updated.subjects).toBe(redoneShot.subjects);
    expect(updated.environment).toBe(redoneShot.environment);
    expect(resolveShotContacts(updated)[0]?.effector).toBe("left_hand");
    expect(updated.revisions?.map((revision) => revision.id)).toEqual(["shr_base", "shr_clip-room_1", "shr_clip-room_2"]);

    const reverted = run({
      type: "SHOT",
      command: { type: "REVERT_SHOT_REVISION", shotId: original.id, revisionId: "shr_clip-room_1" },
    });
    expect(reverted.headRevisionId).toBe("shr_clip-room_1");
    expect(reverted.overrides).toEqual(addRevision?.overrides);
    expect(reverted.revisions?.map((revision) => revision.id)).toEqual(["shr_base", "shr_clip-room_1", "shr_clip-room_2"]);
    expect(reverted.camera).toBe(updated.camera);
    expect(reverted.environment).toBe(updated.environment);
    expect(motionOf(reverted, 0)).toBe(motionOf(updated, 0));
    expect(motionOf(reverted, 0)).toEqual(motionOf(original, 0));
    expect(resolveShotContacts(reverted)[0]?.effector).toBe("right_hand");

    const restored = run({
      type: "SHOT",
      command: { type: "REVERT_SHOT_REVISION", shotId: original.id, revisionId: "shr_base" },
    });
    expect(restored.overrides).toEqual([]);
    expect(restored.headRevisionId).toBe("shr_base");
    expect(restored.revisions).toHaveLength(3);
    expect(resolveShotContacts(restored)[0]?.effector).toBe("left_hand");
    expect(restored.subjects).toBe(reverted.subjects);
    expect(restored.camera).toEqual(original.camera);
    expect(motionOf(restored, 0)).toEqual(motionOf(original, 0));
  });

  it("leaves the shot in place when the actor cannot be resolved", () => {
    const original = baseShot();
    const resolver = createWorldTargetResolver({ [world.id]: world }, { [world.id]: scene });
    const matches = resolver.resolve("없는사람", { selectionIds: [], locale: "ko" });
    expect(subjectForActorRef(original, matches, "없는사람")).toBeUndefined();

    const project = projectFor(original);
    const executed = executeCommand(project, emptyCommandBusState(), {
      type: "SHOT",
      command: {
        type: "ADD_SHOT_OVERRIDE",
        shotId: original.id,
        contactId: "handshake_01",
        actorSubjectId: subjectId("missing-actor"),
        newEffector: "오른손",
        preserve: [],
        recompute: [],
      },
    }, now);
    expect(executed.result.ok).toBe(false);
    expect(executed.project).toBe(project);
    expect(executed.bus.undoStack).toEqual([]);
    expect(currentShot(executed.project)).toBe(original);
  });
});
