import { describe, expect, it } from "vitest";
import { applyShotCommand } from "../../domain/shot";
import { PHASE0_SHOT_ID, PHASE0_WORLD_ID, phase0Scene, phase0Shot } from "../../domain/shot/phase0Sample";
import { shotId } from "../../domain/shot/types";
import { riggedActorImportTransform } from "../../domain/worlds/riggedActorImport";
import type { Project } from "../../domain/project/types";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "./bus";
import { GLTF_SOURCE_AXES, gltfRiggedActorCommand, rigImportAlreadyApplied } from "./gltfRiggedActor";
import { unmappedBoneWarnings } from "../../presentation/viewport/skinnedMeshBones";

const now = "2026-11-13T00:00:00.000Z";

const projectWith = (scene = phase0Scene(), shots: Project["shots"] = projectShots()): Project => ({
  id: "p",
  name: "P",
  createdAt: now,
  updatedAt: now,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq",
  sequences: { seq: { id: "seq", name: "Main", clipIds: [], playhead: 0, visibleRange: [0, 24] } },
  clips: {},
  clipGraphs: {},
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: {},
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
  sceneStates: { [scene.worldId]: scene },
  shots,
});

const projectShots = () => ({ [PHASE0_SHOT_ID]: phase0Shot() });

const load = {
  worldId: PHASE0_WORLD_ID,
  assetId: "ast_phase0_a",
  revisionId: "rev_phase0_a_v1",
  sourcePath: "meshes/phase0/actor-a.glb",
  nodeName: "Armature",
  label: "A",
  restTranslation: [1, 2, 3] as [number, number, number],
  restRotation: [0, 0, 0, 1] as [number, number, number, number],
  restScale: [1, 1, 1] as [number, number, number],
  legacySubjectId: "subject-visitor",
  shotId: PHASE0_SHOT_ID,
  legacyAssetId: "file:visitor",
};

describe("glTF rig import command", () => {
  it("passes glTF axis defaults and keeps an unmapped bone as a warning", () => {
    const bones = [{ name: "pelvis" }, { name: "spine1" }, { name: "left_wrist" }];
    const command = gltfRiggedActorCommand({ ...load, bones });
    expect(command?.type).toBe("IMPORT_RIGGED_ACTOR");
    if (!command || command.type !== "IMPORT_RIGGED_ACTOR") throw new Error("missing command");
    expect(command.source.sourceAxes).toEqual(GLTF_SOURCE_AXES);
    expect(command.source.sourceAxes).toEqual({
      coordinateSystem: "Y_UP",
      upAxis: "Y",
      handedness: "right",
      frontAxis: "+Z",
      metersPerUnit: 1,
    });
    expect(riggedActorImportTransform(command.source.sourceAxes)).toBeUndefined();
    expect(command.source.bones).toEqual(bones);

    const executed = executeCommand(projectWith(), emptyCommandBusState(), command, now);
    expect(executed.result.ok).toBe(true);
    expect(executed.result.reason).toBeUndefined();
    const payload = executed.result.events[0]?.payload;
    expect(payload?.sourceAxes).toEqual(GLTF_SOURCE_AXES);
    expect(unmappedBoneWarnings(payload?.diagnostics)).toEqual(["경고: 매핑되지 않은 본 spine1"]);
    const actorId = payload?.actorId;
    expect(typeof actorId).toBe("string");
    const actor = executed.project.sceneStates?.[PHASE0_WORLD_ID]?.actors[String(actorId)];
    expect(actor?.restTransform.translation).toEqual([1, 2, 3]);
    expect(actor?.restTransform.rotation).toEqual([0, 0, 0, 1]);
    expect(actor?.id.startsWith("act_")).toBe(true);
    expect(executed.bus.undoStack).toHaveLength(1);
  });

  it("restores the same actor id on undo and redo", () => {
    const command = gltfRiggedActorCommand({ ...load, bones: [{ name: "head" }] });
    if (!command || command.type !== "IMPORT_RIGGED_ACTOR") throw new Error("missing command");
    const scene = phase0Scene();
    const before = Object.keys(scene.actors);
    const executed = executeCommand(projectWith(scene), emptyCommandBusState(), command, now);
    const actorId = String(executed.result.events[0]?.payload.actorId);
    expect(before.includes(actorId)).toBe(false);
    const undone = undoCommand(executed.project, executed.bus, now);
    expect(undone.project.sceneStates?.[PHASE0_WORLD_ID]?.actors[actorId]).toBeUndefined();
    const redone = redoCommand(undone.project, undone.bus, now);
    expect(redone.project.sceneStates?.[PHASE0_WORLD_ID]?.actors[actorId]?.importKey).toBe(
      executed.project.sceneStates?.[PHASE0_WORLD_ID]?.actors[actorId]?.importKey,
    );
    expect(rigImportAlreadyApplied(redone.project.sceneStates?.[PHASE0_WORLD_ID], command.source)).toBe(true);
  });

  it("does not change the project when the scene is missing", () => {
    const command = gltfRiggedActorCommand({ ...load, bones: [{ name: "head" }] });
    if (!command) throw new Error("missing command");
    const bare = projectWith();
    const missing = { ...bare, sceneStates: {} };
    const executed = executeCommand(missing, emptyCommandBusState(), command, now);
    expect(executed.result.ok).toBe(false);
    expect(executed.project).toBe(missing);
    expect(executed.result.events).toEqual([]);
    expect(executed.bus.undoStack).toEqual([]);
  });

  it("imports a shot subject whose revision is not in the scene yet", () => {
    const added = applyShotCommand(phase0Shot(), {
      type: "ADD_SUBJECT",
      shotId: shotId(PHASE0_SHOT_ID),
      draft: { kind: "human", id: "subject-visitor", name: "Visitor", fileUri: "meshes/visitor.glb" },
    }, now);
    if (!added.ok) throw new Error(added.reason);
    const subject = added.shot.subjects.find((item) => item.id === "subject-visitor");
    if (!subject || subject.kind === "light" || !subject.assetRef) throw new Error("missing subject");
    expect(phase0Scene().revisions[subject.assetRef.revisionId]).toBeUndefined();
    const command = gltfRiggedActorCommand({
      ...load,
      assetId: subject.assetRef.assetId,
      revisionId: subject.assetRef.revisionId,
      sourcePath: subject.uri,
      bones: [{ name: "right_wrist" }, { name: "unknown_tail" }],
      legacySubjectId: subject.id,
      legacyAssetId: subject.assetId,
    });
    if (!command || command.type !== "IMPORT_RIGGED_ACTOR") throw new Error("missing command");
    const executed = executeCommand(
      projectWith(phase0Scene(), { [added.shot.id]: added.shot }),
      emptyCommandBusState(),
      command,
      now,
    );
    expect(executed.result.ok).toBe(true);
    expect(executed.result.events[0]?.payload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "bone", bone: "unknown_tail", reason: "unmapped" })]),
    );
    expect(unmappedBoneWarnings(executed.result.events[0]?.payload.diagnostics)[0]).toContain("unknown_tail");
    const actorId = String(executed.result.events[0]?.payload.actorId);
    const undone = undoCommand(executed.project, executed.bus, now);
    const restored = undone.project.sceneStates?.[PHASE0_WORLD_ID];
    expect(restored?.actors[actorId]).toBeUndefined();
    expect(restored?.revisions[subject.assetRef.revisionId]).toBeUndefined();
  });
});
