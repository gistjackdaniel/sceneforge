import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "../graph/types";
import type { Project } from "../project/types";
import { projectWithShots } from "../project/migrateToShot";
import { applyShotCommand } from "./evolve";
import { prepareModelInput } from "./modelInput";
import { generateHash, hasSelectedTake, selectedTake } from "./queries";
import { parseShot } from "./schema";
import { shotId, subjectId, type Shot, type ShotCommand } from "./types";

const now = "2026-11-04T00:00:00.000Z";

const empty = (): Shot => parseShot({
  schemaVersion: 1,
  id: "clip-001",
  name: "Shot",
  time: { fps: 24, durationFrames: 48, origin: "clip_local" },
  subjects: [],
  camera: { status: "empty", lens: { focalLengthMm: 35, focusDistanceM: 3, aperture: 2.8 }, interpolation: "linear" },
  renders: [],
});

const step = (shot: Shot, command: ShotCommand) => {
  const edited = applyShotCommand(shot, command, now);
  if (!edited.ok) throw new Error(edited.reason);
  return edited;
};

const withBox = () => step(empty(), {
  type: "ADD_SUBJECT",
  shotId: shotId("clip-001"),
  draft: { kind: "object", id: "box-1", name: "Crate", primitive: "box" },
}).shot;

const poseKey = (frame: number) => ({ frame, position: [1, 0, 0] as [number, number, number], rotationEuler: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] });

const cameraKey = (frame: number) => ({ frame, position: [0, 1, 4] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], focalLengthMm: 35 });

describe("shot record", () => {
  it("keeps text and explicit pose in one channel", () => {
    const box = withBox();
    const keyed = step(box, { type: "KEY_SUBJECT_POSE", shotId: box.id, subjectId: subjectId("box-1"), key: poseKey(4) }).shot;
    const subject = keyed.subjects[0];
    expect(subject.kind !== "light" && subject.motion.channel).toBe("explicit");
    const text = step(keyed, { type: "SET_TEXT_POSE", shotId: keyed.id, subjectId: subjectId("box-1"), prompt: "walks" }).shot;
    expect(text.subjects[0].kind !== "light" && text.subjects[0].motion).toEqual({ channel: "text", prompt: "walks" });
    const again = step(text, { type: "KEY_SUBJECT_POSE", shotId: text.id, subjectId: subjectId("box-1"), key: poseKey(2) }).shot;
    const motion = again.subjects[0].kind === "light" ? undefined : again.subjects[0].motion;
    expect(motion?.channel === "explicit" && motion.keys).toHaveLength(1);
    const kept = step(again, { type: "SET_TEXT_POSE", shotId: again.id, subjectId: subjectId("box-1"), prompt: "  " });
    expect(kept.changed).toBe(false);
    const cleared = step(again, { type: "DELETE_SUBJECT_POSE_KEY", shotId: again.id, subjectId: subjectId("box-1"), frame: 2 }).shot;
    expect(cleared.subjects[0].kind !== "light" && cleared.subjects[0].motion.channel).toBe("unset");
  });

  it("refuses a pose key on a light", () => {
    const lit = step(empty(), { type: "ADD_SUBJECT", shotId: shotId("clip-001"), draft: { kind: "light", id: "light-1", name: "Key" } }).shot;
    const edited = applyShotCommand(lit, { type: "KEY_SUBJECT_POSE", shotId: lit.id, subjectId: subjectId("light-1"), key: poseKey(0) }, now);
    expect(edited.ok).toBe(false);
  });

  it("enables generation from the selected take and hashes the recipe", () => {
    expect(hasSelectedTake(withBox())).toBe(false);
    const ready = step(withBox(), { type: "KEY_CAMERA", shotId: shotId("clip-001"), key: cameraKey(0) }).shot;
    expect(hasSelectedTake(ready)).toBe(true);
    const second = step(ready, { type: "COMMIT_CAMERA_TAKE", shotId: ready.id, source: "manual", keys: [cameraKey(3)] }).shot;
    const input = prepareModelInput(second, undefined, "16:9");
    expect(input.ok && input.input.camera.takeId).toBe(selectedTake(second)?.id);
    expect(input.ok && input.input.camera.keys).toHaveLength(1);
    const renamed = {
      ...second,
      subjects: second.subjects.map((subject) => ({ ...subject, name: "Renamed" })),
    };
    expect(generateHash(renamed)).toBe(generateHash(second));
    const recorded = step(second, {
      type: "RECORD_SHOT_RENDER",
      shotId: second.id,
      receipt: {
        id: "render-1",
        jobId: "job-1",
        connectorId: "stub",
        modelVersion: "none",
        generateHash: generateHash(second),
        status: "stubbed",
        recordedAt: now,
        message: "연결된 영상 모델이 없어 파일을 만들지 않았습니다.",
      },
    }).shot;
    expect(recorded.subjects).toEqual(second.subjects);
    expect(recorded.camera).toEqual(second.camera);
    expect(step(recorded, {
      type: "RECORD_SHOT_RENDER",
      shotId: recorded.id,
      receipt: recorded.renders[0],
    }).changed).toBe(false);
  });

  it("blocks marker-only and proxy scenes inside the model input", () => {
    const marked = step(empty(), {
      type: "ADD_SUBJECT",
      shotId: shotId("clip-001"),
      draft: { kind: "marker", id: "mark-1", name: "Mark", role: "human" },
    }).shot;
    const posed = step(marked, { type: "SET_TEXT_POSE", shotId: marked.id, subjectId: subjectId("mark-1"), prompt: "stands" }).shot;
    const ready = step(posed, { type: "KEY_CAMERA", shotId: posed.id, key: cameraKey(0) }).shot;
    expect(hasSelectedTake(ready)).toBe(true);
    expect(prepareModelInput(ready, undefined, "16:9").ok).toBe(false);
    expect(prepareModelInput(ready, {
      worldId: "world",
      representation: "image_based_proxy",
      geometryUri: "mesh.glb",
      coordinateSystem: "Y_UP",
      unitScaleMeters: 1,
    }, "16:9").ok).toBe(false);
    const mesh = step(withBox(), { type: "KEY_CAMERA", shotId: shotId("clip-001"), key: cameraKey(1) }).shot;
    expect(prepareModelInput(mesh, undefined, "16:9").ok).toBe(true);
  });
});

const node = (id: string, kind: NodeBase["kind"], parameters: Record<string, unknown>): NodeBase => ({
  id,
  name: id,
  kind,
  type: kind,
  category: "cinematic",
  scope: "project",
  enabled: true,
  tags: [],
  version: 1,
  referenceType: "shared",
  parameters,
  params: parameters,
  downstreamNodeIds: [],
  status: "clean",
  inputPorts: defaultPorts().inputPorts,
  outputPorts: defaultPorts().outputPorts,
  createdAt: now,
  updatedAt: now,
});

describe("clip migration", () => {
  it("keeps explicit keys, drops an empty take, and does not migrate a valid shot again", () => {
    const project: Project = {
      id: "p",
      name: "P",
      createdAt: now,
      updatedAt: now,
      metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
      activeSequenceId: "seq",
      sequences: { seq: { id: "seq", name: "Main", clipIds: ["clip-001"], playhead: 0, visibleRange: [0, 24], fps: 24 } },
      clips: {
        "clip-001": {
          id: "clip-001",
          name: "Opening",
          start: 0,
          end: 24,
          duration: 24,
          durationFrames: 24,
          sourceType: "empty" as const,
          clipGraphId: "graph",
          cameraPathNodeId: "camera",
          cacheStatus: "valid" as const,
          linkedWorldId: "world-1",
        },
      },
      clipGraphs: {
        graph: { id: "graph", clipId: "clip-001", rootNodeId: "place", nodeIds: ["place", "track", "camera"], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] },
      },
      nodes: {
        place: node("place", "PlacementNode", {
          worldElementId: "hero",
          label: "Hero",
          representation: "box",
          posePrompt: "waves",
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        }),
        track: node("track", "ObjectTrajectoryNode", {
          targetElementId: "hero",
          interpolation: "linear",
          keyframes: [{ frame: 0, position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
        }),
        camera: node("camera", "CameraPathNode", {
          interpolation: "bezier",
          activeTakeId: "take-a",
          takes: [
            { id: "take-a", name: "A", source: "manual", createdAt: now, keyframes: [{ frame: 0, position: [0, 1, 2], rotation: [0, 0, 0, 1], focalLengthMm: 35 }] },
            { id: "take-empty", name: "Empty", source: "record", createdAt: now, keyframes: [] },
          ],
        }),
      },
      references: {},
      dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
      worlds: {},
      assets: {},
      caches: {},
      connectors: {},
      libraryNodeIds: [],
    };
    const migrated = projectWithShots(project);
    const shot = migrated.shots?.["clip-001"];
    expect(shot?.id).toBe("clip-001");
    expect(shot?.subjects[0]?.kind !== "light" && shot?.subjects[0]?.motion.channel).toBe("explicit");
    expect(shot?.camera.interpolation).toBe("linear");
    expect(shot?.camera.status === "ready" && shot.camera.takes.map((take) => take.id)).toEqual(["take-a"]);
    const renamedNodes = {
      ...migrated,
      nodes: { ...migrated.nodes, place: { ...migrated.nodes.place, parameters: { ...migrated.nodes.place.parameters, label: "Changed" }, params: {} } },
    };
    expect(projectWithShots(renamedNodes).shots?.["clip-001"]?.subjects[0]?.name).toBe("Hero");
  });
});
