import { describe, expect, it } from "vitest";
import { createMeshExampleWorld } from "../../domain/worlds/sampleWorlds";
import type { Project } from "../../domain/project/types";
import { migrateProject } from "../../domain/project/migrate";
import { deserializeProject, serializeProject } from "../../infrastructure/persistence/serializeProject";
import {
  FIXTURE_CAMERA_TRACK_ID,
  FIXTURE_INSTANCE_IDS,
  HANDSHAKE_SCENE_ID,
  cameraPoseAt,
  canonicalizeSceneValue,
  materializeAttachments,
  previewStateEqual,
  projectPreviewState,
  resolveContacts,
  resolvedJointTrack,
  samplePlayback,
} from "../../domain/sceneAuthoring";
import { distance } from "../../domain/sceneAuthoring/math";
import { jointPosition } from "../../domain/sceneAuthoring/playback";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "./bus";

const now = "2026-11-04T00:00:00.000Z";

const projectFixture = (): Project => ({
  id: "p-handshake",
  name: "Handshake",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq-1",
  sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: [], playhead: 0, visibleRange: [0, 81] } },
  clips: {},
  clipGraphs: {},
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: { [createMeshExampleWorld().id]: createMeshExampleWorld() },
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

const changeHand = {
  type: "CHANGE_CONTACT_EFFECTOR" as const,
  sceneId: HANDSHAKE_SCENE_ID,
  subjectRef: "B",
  locale: "ko" as const,
  contactId: "handshake_01",
  rigPart: "right_hand" as const,
};

describe("change B's handshake hand", () => {
  it("keeps the camera, background, and A's root motion while the source contact stays left", () => {
    let project = projectFixture();
    let bus = emptyCommandBusState();
    const installed = executeCommand(project, bus, { type: "INSTALL_INTERACTION_SCENE" }, now);
    expect(installed.result.ok).toBe(true);
    project = installed.project;
    bus = installed.bus;
    const before = project.interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(before).toBeDefined();
    if (!before) return;

    const edited = executeCommand(project, bus, changeHand, now);
    expect(edited.result.ok).toBe(true);
    project = edited.project;
    bus = edited.bus;
    const after = project.interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(after).toBeDefined();
    if (!after) return;

    expect(after.contacts).toBe(before.contacts);
    expect(after.poses).toBe(before.poses);
    expect(after.camera).toBe(before.camera);
    expect(after.objects).toBe(before.objects);
    expect(before.contacts.find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");
    expect(resolveContacts(after).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");

    const a = FIXTURE_INSTANCE_IDS.actorA;
    const b = FIXTURE_INSTANCE_IDS.actorB;
    const preserved = [
      { kind: "camera_track" as const, cameraTrackId: FIXTURE_CAMERA_TRACK_ID },
      { kind: "actor_root_motion" as const, instanceId: a },
      { kind: "background" as const },
      { kind: "instance_identity" as const },
      { kind: "attachment" as const },
    ];
    for (const selector of preserved) {
      expect(previewStateEqual(projectPreviewState(before, selector), projectPreviewState(after, selector))).toBe(true);
    }
    expect(previewStateEqual(cameraPoseAt(before, 36), cameraPoseAt(after, 36))).toBe(true);
    expect(
      previewStateEqual(
        projectPreviewState(before, { kind: "actor_motion", instanceId: b }),
        projectPreviewState(after, { kind: "actor_motion", instanceId: b }),
      ),
    ).toBe(false);
    expect(
      previewStateEqual(
        projectPreviewState(before, { kind: "contact", contactId: "handshake_01" }),
        projectPreviewState(after, { kind: "contact", contactId: "handshake_01" }),
      ),
    ).toBe(false);
    expect(materializeAttachments(after).map((span) => span.sourceContactId)).toEqual(["cup_hold_01", "cup_place_01"]);
    expect(materializeAttachments(after)[0]?.rigPart).toBe("left_hand");

    const beforeMeet = samplePlayback(before, 36);
    const afterMeet = samplePlayback(after, 36);
    const aHand = jointPosition(afterMeet.actors.find((actor) => actor.instanceId === a)!, "right_wrist");
    const bRight = jointPosition(afterMeet.actors.find((actor) => actor.instanceId === b)!, "right_wrist");
    const bLeft = jointPosition(afterMeet.actors.find((actor) => actor.instanceId === b)!, "left_wrist");
    const bLeftBefore = jointPosition(beforeMeet.actors.find((actor) => actor.instanceId === b)!, "left_wrist");
    expect(aHand).toBeDefined();
    expect(bRight).toBeDefined();
    expect(bLeft).toBeDefined();
    expect(bLeftBefore).toBeDefined();
    if (!aHand || !bRight || !bLeft || !bLeftBefore) return;
    expect(distance(aHand, bRight)).toBeLessThan(distance(aHand, bLeft));
    expect(distance(bLeftBefore, bLeft)).toBeGreaterThan(0.05);
    expect(afterMeet.actors.find((actor) => actor.instanceId === a)?.root).toEqual(
      beforeMeet.actors.find((actor) => actor.instanceId === a)?.root,
    );

    const undone = undoCommand(project, bus, now);
    expect(undone.result.ok).toBe(true);
    const restored = undone.project.interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(restored && resolveContacts(restored).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe(
      "left_hand",
    );
    expect(restored && canonicalizeSceneValue(resolvedJointTrack(restored, b))).toBe(
      canonicalizeSceneValue(resolvedJointTrack(before, b)),
    );

    const redone = redoCommand(undone.project, undone.bus, now);
    expect(redone.result.ok).toBe(true);
    const again = redone.project.interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(again && resolveContacts(again).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe(
      "right_hand",
    );
  });

  it("fails the root-motion check when A's translation moves by 1mm", () => {
    const shot = executeCommand(projectFixture(), emptyCommandBusState(), { type: "INSTALL_INTERACTION_SCENE" }, now).project
      .interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(shot).toBeDefined();
    if (!shot) return;
    const selector = { kind: "actor_root_motion" as const, instanceId: FIXTURE_INSTANCE_IDS.actorA };
    const pose = shot.poses.find((item) => item.instanceId === FIXTURE_INSTANCE_IDS.actorA);
    expect(pose).toBeDefined();
    if (!pose) return;
    const [x, y, z] = pose.root[0].translation;
    const nudged = {
      ...shot,
      poses: shot.poses.map((item) =>
        item.instanceId === pose.instanceId
          ? { ...item, root: [{ ...item.root[0], translation: [x + 0.001, y, z] as [number, number, number] }, ...item.root.slice(1)] }
          : item,
      ),
    };
    expect(previewStateEqual(projectPreviewState(shot, selector), projectPreviewState(nudged, selector))).toBe(false);
  });

  it("does not install over an existing world id and rejects an unknown name", () => {
    const installed = executeCommand(projectFixture(), emptyCommandBusState(), { type: "INSTALL_INTERACTION_SCENE" }, now);
    const again = executeCommand(installed.project, installed.bus, { type: "INSTALL_INTERACTION_SCENE" }, now);
    expect(again.result.ok).toBe(true);
    expect(again.result.inverse).toBeUndefined();
    expect(again.project.worlds[createMeshExampleWorld().id]?.name).toBe("Apartment Livingroom");
    const missing = executeCommand(installed.project, installed.bus, { ...changeHand, subjectRef: "없는사람" }, now);
    expect(missing.result.ok).toBe(false);
    expect(missing.project).toBe(installed.project);
  });

  it("round-trips the scene through project JSON", () => {
    const installed = executeCommand(projectFixture(), emptyCommandBusState(), { type: "INSTALL_INTERACTION_SCENE" }, now);
    const edited = executeCommand(installed.project, installed.bus, changeHand, now);
    const loaded = migrateProject(deserializeProject(serializeProject(edited.project)), {
      buildDependencyMap: () => edited.project.dependencyMap,
      syncClipCacheFields: (clip) => clip,
    });
    const scene = loaded.interactiveScenes?.[HANDSHAKE_SCENE_ID];
    expect(scene?.overrides[0]?.rigPart).toBe("right_hand");
    expect(scene?.contacts.find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");
    expect(loaded.worlds[createMeshExampleWorld().id]?.id).toBe(createMeshExampleWorld().id);
  });
});
