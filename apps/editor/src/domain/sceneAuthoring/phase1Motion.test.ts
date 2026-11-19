import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../application/commands/apply";
import { environmentFromWorld } from "../../application/services/shotEnvironment";
import type { Project } from "../project/types";
import { prepareModelInput } from "../shot/modelInput";
import { motionConditionGraph, motionSpanAt } from "../shot/motionConditions";
import { shotId } from "../shot/types";
import { importedWorldUri, PHASE1_CLASSROOM_WORLD, shotWorldRevisionId } from "../worlds/importedShotWorld";
import { normalizeWorldAsset } from "../worlds/normalize";
import { PHASE1_ACTORS, PHASE1_MOTIONS, PHASE1_SHOT_ID, PHASE1_WORLD_ID } from "./phase1Demo";
import { compareMotionEdit, reviewMotionState } from "./reviewMotionEdit";
import { somaMotionSchema } from "./somaMotion";

const ctx = { timestamp: "2026-11-18T00:00:00.000Z" };
const empty: Project = {
  id: "project", name: "Project", createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "seq", sequences: {}, clips: {}, clipGraphs: {}, nodes: {}, references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: {}, assets: {}, caches: {}, connectors: {}, libraryNodeIds: [],
};
const installed = () => applyCommand(empty, { type: "INSTALL_PHASE1_DEMO" }, ctx).project;
const clips = () => new Map(Object.values(PHASE1_MOTIONS).map((source) => [source.sha256, somaMotionSchema.parse(
  JSON.parse(readFileSync(new URL(`../../../public${source.uri}`, import.meta.url), "utf8")),
)]));

describe("Phase 1 editable motion", () => {
  it("overrides B only within the requested span and supplies that graph to model input", () => {
    const before = installed();
    const shot = before.shots![PHASE1_SHOT_ID];
    const edited = applyCommand(before, { type: "SHOT", command: { type: "SET_TIMELINE_MOTION", shotId: shot.id, edits: [
      { subjectId: PHASE1_ACTORS.b, source: PHASE1_MOTIONS.bow, startFrame: 60, endFrame: 90 },
    ] } }, ctx);
    expect(edited.result.ok).toBe(true);
    const after = edited.project.shots![shot.id];
    const graph = motionConditionGraph(after);
    expect(motionSpanAt(graph, PHASE1_ACTORS.b, 59)?.sourceId).toBe(PHASE1_MOTIONS.wave.sha256);
    expect(motionSpanAt(graph, PHASE1_ACTORS.b, 60)?.sourceId).toBe(PHASE1_MOTIONS.bow.sha256);
    expect(motionSpanAt(graph, PHASE1_ACTORS.b, 90)?.sourceId).toBe(PHASE1_MOTIONS.wave.sha256);
    const motion = clips();
    const world = before.worlds[PHASE1_WORLD_ID];
    expect(compareMotionEdit(reviewMotionState(shot, world, motion), reviewMotionState(after, world, motion))).toEqual({
      camera: true, background: true, actorARoot: true, actorBChanged: true,
    });
    const payload = prepareModelInput(after, environmentFromWorld(world, after.environment?.revisionId), "2.39:1");
    expect(payload.ok && payload.input.motionConditions).toEqual(graph);
    expect(payload.ok && payload.input.environment?.revisionId).toBe(shotWorldRevisionId(PHASE1_CLASSROOM_WORLD));
  });

  it("gives an unpinned shared room a shot-local replacement", () => {
    const before = installed();
    const original = before.shots![PHASE1_SHOT_ID];
    const legacy = { ...original, environment: { worldId: "world-shared" } };
    const other = { ...legacy, id: shotId("shot-shared-room") };
    const shared = normalizeWorldAsset({ id: "world-shared", name: "Legacy room", surfaceMeshPath: "old-room.glb" });
    const project = { ...before, shots: { [legacy.id]: legacy, [other.id]: other }, worlds: { ...before.worlds, [shared.id]: shared } };
    const contentHash = "f".repeat(64);
    const result = applyCommand(project, { type: "REGISTER_SHOT_WORLD", shotId: legacy.id, worldId: shared.id, imported: {
      ...PHASE1_CLASSROOM_WORLD, uri: importedWorldUri(contentHash), contentHash,
    } }, ctx);
    expect(result.result.ok).toBe(true);
    expect(result.project.shots![legacy.id].environment?.worldId).not.toBe(shared.id);
    expect(result.project.shots![other.id]).toBe(other);
    expect(result.project.worlds[shared.id]).toBe(shared);
  });
});
