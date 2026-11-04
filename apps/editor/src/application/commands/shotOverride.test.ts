import { describe, expect, it } from "vitest";
import { createAssetRecord } from "../../domain/assets/registry";
import type { Project } from "../../domain/project/types";
import { createShotForClip, shotFps } from "../../domain/timeline/shot";
import { resolveShotScene } from "../../domain/timeline/shotEdit";
import { assetRevisionRefFromRecord, type ShotScene } from "../../domain/timeline/shotScene";
import type { TimelineClip } from "../../domain/timeline/types";
import type { WorldAsset } from "../../domain/worlds/types";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "./bus";

const NOW = "2026-04-01T00:00:00.000Z";
const LOCALITY = {
  preserve: ["camera_track", "actor_A_root_motion", "set_layout"],
  recompute: ["actor_B_motion", "contact", "dependent_render_passes"],
};

const world = (): WorldAsset => ({
  id: "world-room",
  name: "Handshake Room",
  description: "Two actors and a table",
  representation: "hybrid",
  sourceAssetIds: ["asset-world-room"],
  rootUri: "worlds/room",
  coordinateSystem: "Y_UP",
  unitScaleMeters: 1,
  semanticTags: [],
  version: 3,
  createdAt: NOW,
  updatedAt: NOW,
  usdPath: "",
  semanticsPath: "",
  navmeshPath: "",
  previewPath: "",
  proxyKind: "usd",
  props: ["table"],
  elements: [
    { id: "elem-a", name: "A", kind: "actor_mark", description: "Actor A" },
    { id: "elem-b", name: "B", kind: "actor_mark", description: "Actor B" },
  ],
});

const scene = (): ShotScene => ({
  cameraTracks: {
    cam_take: {
      id: "cam_take",
      samples: [
        { frame: 0, position: [0, 1.6, 4], rotation: [0, 0, 0, 1] },
        { frame: 24, position: [0.2, 1.6, 3.6], rotation: [0, 0.02, 0, 0.9998] },
      ],
    },
  },
  setLayout: {
    setAssetRef: { assetId: "asset-set", revisionId: "asset-set@1" },
    objects: [
      {
        id: "obj_table",
        assetRef: { assetId: "asset-table", revisionId: "asset-table@2" },
        restTranslation: [0, 0, 0],
        restRotation: [0, 0, 0, 1],
      },
    ],
  },
  actors: {
    act_A: { id: "act_A", label: "A" },
    act_B: { id: "act_B", label: "B" },
  },
  actorRootMotions: {
    act_A: [
      { frame: 0, transl: [0, 0, 0], globalOrient: [0, 0, 0, 1] },
      { frame: 40, transl: [0.4, 0, 0.2], globalOrient: [0, 0.1, 0, 0.995] },
    ],
    act_B: [
      { frame: 0, transl: [1, 0, 0], globalOrient: [0, 0, 0, 1] },
      { frame: 40, transl: [0.6, 0, 0.1], globalOrient: [0, -0.1, 0, 0.995] },
    ],
  },
  contacts: {
    handshake_01: {
      id: "handshake_01",
      actorId: "act_B",
      targetActorId: "act_A",
      effector: "left_hand",
      frameRange: [10, 40],
    },
  },
});

const projectFixture = (): { project: Project; shotId: string } => {
  const room = world();
  const asset = createAssetRecord({
    id: "asset-world-room",
    type: "world",
    name: room.name,
    uri: room.rootUri,
    version: room.version,
    contentHash: "roomhash1",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const clip: TimelineClip = {
    id: "clip-handshake",
    name: "Handshake",
    start: 12,
    end: 93,
    duration: 81,
    startFrame: 12,
    durationFrames: 81,
    sourceType: "empty",
    clipGraphId: "graph-handshake",
    cacheStatus: "valid",
    linkedWorldId: room.id,
  };
  const base = createShotForClip({
    clip,
    fps: 24,
    id: "sht_handshake",
    createdAt: NOW,
    assetRefs: [assetRevisionRefFromRecord(asset)],
  });
  const shot = {
    ...base,
    scene: scene(),
    approvals: [{ id: "apr_1", revisionId: base.headRevisionId, status: "pending" as const, note: "slot" }],
  };
  clip.shotId = shot.id;
  const project: Project = {
    id: "project-handshake",
    name: "Handshake",
    createdAt: NOW,
    updatedAt: NOW,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    sequences: {
      "seq-1": { id: "seq-1", name: "Main", clipIds: [clip.id], playhead: 0, visibleRange: [0, 120], fps: 24 },
    },
    clips: { [clip.id]: clip },
    shots: { [shot.id]: shot },
    clipGraphs: {},
    nodes: {},
    references: {},
    dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
    worlds: { [room.id]: room },
    assets: { [asset.id]: asset },
    caches: {},
    connectors: {},
    libraryNodeIds: [],
  };
  return { project, shotId: shot.id };
};

describe("shot contact override", () => {
  it("changes B's contact hand without writing camera, set layout, or A's root motion", () => {
    const { project, shotId } = projectFixture();
    const original = project.shots![shotId];
    const originalResolved = resolveShotScene(original.scene, original.overrides);

    const added = executeCommand(
      project,
      emptyCommandBusState(),
      {
        type: "ADD_SHOT_OVERRIDE",
        shotId,
        actorRef: "B",
        targetActorRef: "A",
        contactId: "handshake_01",
        newEffector: "오른손",
        locality: LOCALITY,
      },
      NOW,
    );
    expect(added.result.ok).toBe(true);
    const edited = added.project.shots![shotId];
    const editedResolved = resolveShotScene(edited.scene, edited.overrides);

    expect(edited.scene).toBe(original.scene);
    expect(edited.approvals).toBe(original.approvals);
    expect(original.scene.contacts.handshake_01.effector).toBe("left_hand");
    expect(edited.overrides[0]?.actorId).toBe("act_B");
    expect(edited.overrides[0]?.targetActorId).toBe("act_A");
    expect(edited.overrides[0]?.newEffector).toBe("right_hand");
    expect(edited.overrides[0]?.locality).toEqual(LOCALITY);
    expect(editedResolved.contacts.handshake_01.effector).toBe("right_hand");
    expect(editedResolved.cameraTracks).toEqual(originalResolved.cameraTracks);
    expect(editedResolved.setLayout).toEqual(originalResolved.setLayout);
    expect(editedResolved.actorRootMotions.act_A).toEqual(originalResolved.actorRootMotions.act_A);
    expect(editedResolved.actorRootMotions.act_B).toEqual(originalResolved.actorRootMotions.act_B);
    expect(edited.revisions[1]?.assetRefs).toEqual(edited.revisions[0]?.assetRefs);
    expect(edited.revisions[0]?.assetRefs).toEqual([{ assetId: "asset-world-room", revisionId: "asset-world-room@3" }]);
    expect(shotFps(edited)).toBe(24);

    const undone = undoCommand(added.project, added.bus, NOW);
    expect(undone.project.shots![shotId]).toEqual(original);
    expect(undone.project.shots![shotId].scene).toBe(original.scene);
    expect(resolveShotScene(undone.project.shots![shotId].scene, undone.project.shots![shotId].overrides)).toEqual(
      originalResolved,
    );

    const redone = redoCommand(undone.project, undone.bus, NOW);
    expect(redone.project.shots![shotId].overrides).toEqual(edited.overrides);
    expect(resolveShotScene(redone.project.shots![shotId].scene, redone.project.shots![shotId].overrides).contacts.handshake_01.effector).toBe(
      "right_hand",
    );

    const eventId = edited.overrides[0].id;
    const rev1 = original.headRevisionId;
    const rev2 = edited.headRevisionId;
    const updated = executeCommand(
      redone.project,
      redone.bus,
      { type: "UPDATE_SHOT_OVERRIDE", shotId, overrideId: eventId, newEffector: "left_hand" },
      NOW,
    );
    expect(updated.result.ok).toBe(true);
    expect(
      resolveShotScene(updated.project.shots![shotId].scene, updated.project.shots![shotId].overrides).contacts.handshake_01
        .effector,
    ).toBe("left_hand");
    expect(updated.project.shots![shotId].scene.contacts.handshake_01.effector).toBe("left_hand");

    const revertedToEdit = executeCommand(
      updated.project,
      updated.bus,
      { type: "REVERT_SHOT_REVISION", shotId, revisionId: rev2 },
      NOW,
    );
    expect(revertedToEdit.result.ok).toBe(true);
    expect(revertedToEdit.project.shots![shotId].headRevisionId).toBe(rev2);
    expect(revertedToEdit.project.shots![shotId].overrides).toEqual(edited.overrides);
    expect(revertedToEdit.project.shots![shotId].revisions).toEqual(updated.project.shots![shotId].revisions);
    expect(
      resolveShotScene(revertedToEdit.project.shots![shotId].scene, revertedToEdit.project.shots![shotId].overrides),
    ).toEqual(editedResolved);

    const revertedToOrigin = executeCommand(
      revertedToEdit.project,
      revertedToEdit.bus,
      { type: "REVERT_SHOT_REVISION", shotId, revisionId: rev1 },
      NOW,
    );
    expect(revertedToOrigin.project.shots![shotId].headRevisionId).toBe(rev1);
    expect(revertedToOrigin.project.shots![shotId].overrides).toEqual(original.overrides);
    expect(resolveShotScene(revertedToOrigin.project.shots![shotId].scene, revertedToOrigin.project.shots![shotId].overrides)).toEqual(
      originalResolved,
    );
    expect(revertedToOrigin.project.shots![shotId].approvals).toEqual(original.approvals);
    expect(revertedToOrigin.project.shots![shotId].scene).toBe(original.scene);

    const removed = executeCommand(
      redone.project,
      redone.bus,
      { type: "REMOVE_SHOT_OVERRIDE", shotId, overrideId: eventId },
      NOW,
    );
    expect(removed.result.ok).toBe(true);
    expect(removed.project.shots![shotId].overrides).toEqual([]);
    expect(resolveShotScene(removed.project.shots![shotId].scene, removed.project.shots![shotId].overrides)).toEqual(
      originalResolved,
    );
    const undoneRemoval = undoCommand(removed.project, removed.bus, NOW);
    expect(undoneRemoval.project.shots![shotId].overrides).toEqual(edited.overrides);
  });

  it("does not change the project when the actor cannot be resolved", () => {
    const { project, shotId } = projectFixture();
    const missed = executeCommand(
      project,
      emptyCommandBusState(),
      {
        type: "ADD_SHOT_OVERRIDE",
        shotId,
        actorRef: "없는사람",
        contactId: "handshake_01",
        newEffector: "오른손",
        locality: LOCALITY,
      },
      NOW,
    );
    expect(missed.result.ok).toBe(false);
    expect(missed.project).toBe(project);
    expect(missed.bus.undoStack).toHaveLength(0);
    expect(project.shots![shotId].scene.contacts.handshake_01.effector).toBe("left_hand");
  });
});
