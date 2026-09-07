import { describe, expect, it } from "vitest";
import { defaultPorts, type NodeBase } from "../../domain/graph/types";
import type { ClipGraph } from "../clipgraph/types";
import type { TimelineClip } from "../../domain/timeline/types";
import { lyraVideoRenderInputSchema } from "./schemas";
import { buildVideoRenderInput } from "./videoRenderInput";

const node = (
  id: string,
  kind: NodeBase["kind"],
  parameters: Record<string, unknown>,
): NodeBase => {
  const ports = defaultPorts();
  return {
    id,
    name: id,
    kind,
    type: kind,
    category: kind === "PerformancePlanNode" ? "performance" : "cinematic",
    scope: "clip",
    enabled: true,
    tags: [],
    version: 1,
    referenceType: "local",
    parameters,
    params: parameters,
    downstreamNodeIds: [],
    status: "clean",
    inputPorts: ports.inputPorts,
    outputPorts: ports.outputPorts,
    createdAt: "t",
    updatedAt: "t",
  };
};

describe("video render direction contract", () => {
  it("keeps precise camera data and strips rough 3D character motion", () => {
    const clip: TimelineClip = {
      id: "clip-1",
      name: "Shot",
      start: 100,
      end: 148,
      duration: 48,
      startFrame: 100,
      durationFrames: 48,
      sourceType: "empty",
      clipGraphId: "graph-1",
      cameraPathNodeId: "camera-path",
      performancePlanNodeId: "performance-plan",
      cacheStatus: "invalid",
    };
    const graph: ClipGraph = {
      id: "graph-1",
      clipId: clip.id,
      rootNodeId: "root",
      nodeIds: ["root", "camera-path", "lens", "actor-placement", "actor-b-placement", "performance-plan", "capture-a", "capture-b"],
      edges: [],
      previewFrames: [],
      finalFrames: [],
      keyframeNodeIds: ["capture-a", "capture-b"],
    };
    const nodes: Record<string, NodeBase> = {
      root: node("root", "TimelineClipNode", { clipId: clip.id }),
      "camera-path": node("camera-path", "CameraPathNode", {
        interpolation: "bezier",
        lookAtTargetElementId: "actor-a",
        continuity: {
          lineOfActionLabel: "Actor A → Actor B",
          lineActorAId: "actor-a",
          lineActorBId: "actor-b",
          cameraSide: "left",
          screenDirection: "left_to_right",
        },
        keyframes: [
          { frame: 0, position: [0, 1.7, 4], rotation: [0, 0, 0, 1], focalLengthMm: 35 },
          { frame: 47, position: [0, 1.7, 2], rotation: [0, 0, 0, 1], focalLengthMm: 50 },
        ],
      }),
      lens: node("lens", "LensNode", { focalLengthMm: 40, focusDistanceM: 2.4, aperture: 2.8, sensorPreset: "super35" }),
      "actor-placement": node("actor-placement", "ActorPlacementNode", {
        worldElementId: "actor-a",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 1.57, z: 0 },
      }),
      "actor-b-placement": node("actor-b-placement", "ActorPlacementNode", {
        worldElementId: "actor-b",
        position: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: -1.57, z: 0 },
      }),
      "performance-plan": node("performance-plan", "PerformancePlanNode", {
        sources: [
          { id: "text", type: "text_prompt", label: "Acting note", notes: "A restrained double take.", enabled: true },
          { id: "disabled", type: "motion_capture", label: "Rejected mocap", uri: "bad.fbx", enabled: false },
        ],
        cues: [
          { id: "line", kind: "dialogue", label: "Line", direction: "Finish dry.", startFrame: 4, endFrame: 18, sourceId: "text" },
          { id: "react", kind: "reaction", label: "Double take", direction: "Two-beat glance.", startFrame: 20, endFrame: 30, sourceId: "text" },
        ],
        audioGuide: { label: "Premiere dialogue edit", uri: "audio/dialogue.wav", offsetFrame: 0, durationFrames: 48 },
      }),
      "capture-a": node("capture-a", "KeyframeNode", {
        playhead: 100,
        camera: { position: [9, 9, 9], rotation: [0, 0, 0], focalLength: 18 },
        objects: [{ id: "actor-a", kind: "actor", position: [0, 0, 0], rotation: [0, 0, 0] }],
      }),
      "capture-b": node("capture-b", "KeyframeNode", {
        playhead: 124,
        camera: { position: [8, 8, 8], rotation: [0, 0, 0], focalLength: 18 },
        objects: [{ id: "actor-a", kind: "actor", position: [4, 0, 0], rotation: [0, 2, 0] }],
      }),
    };

    const input = buildVideoRenderInput(clip, graph, nodes, undefined, 112, "world look only", {
      rerenderScope: [
        { channel: "performance_face", frameRanges: [{ startFrame: 20, endFrame: 30 }] },
      ],
    });

    expect(input.keyframes).toHaveLength(2);
    expect(input.keyframes.every((keyframe) => keyframe.objects.length === 0)).toBe(true);
    expect(input.directionContract.shot.keyframes[1]).toMatchObject({ frame: 47, focalLengthMm: 50 });
    expect(input.directionContract.version).toBe(2);
    expect(input.directionContract.shot.stagingAnchors).toEqual([
      { id: "actor-a", kind: "actor", position: [0, 0, 0], rotation: [0, 1.57, 0] },
      { id: "actor-b", kind: "actor", position: [2, 0, 0], rotation: [0, -1.57, 0] },
    ]);
    expect(input.directionContract.shot.continuityValidation?.status).toBe("valid");
    expect(input.directionContract.shot.ignoredCharacterSignals).toContain("contact");
    expect(input.directionContract.capabilityNegotiation.channels.every((item) => item.status === "accepted")).toBe(true);
    expect(input.directionContract.performance.sources.map((source) => source.id)).toEqual(["text"]);
    expect(input.directionContract.performance.cues.map((cue) => cue.kind)).toEqual(["dialogue", "reaction"]);
    expect(input.directionContract.performance.audioGuide?.uri).toBe("audio/dialogue.wav");
    expect(input.rerenderScope).toEqual({
      mode: "partial",
      invalidations: [
        { channel: "performance_face", frameRanges: [{ startFrame: 20, endFrame: 30 }] },
      ],
    });
    expect(() => lyraVideoRenderInputSchema.parse(input)).not.toThrow();
  });
});
