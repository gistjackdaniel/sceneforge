import type { ClipGraph } from "../clipgraph/types";
import type { NodeBase } from "../nodes/types";
import type { TimelineClip } from "../project/types";
import type { StageKeyframePose, LyraVideoRenderInput } from "../lyra/types";
import type { WorldAsset } from "../world/types";

const defaultCamera = (): StageKeyframePose["camera"] => ({
  position: [2.5, 1.8, 3.2],
  rotation: [0, 0, 0],
  focalLength: 35,
});

/** Build Lyra video render input from clip graph keyframes and world artifacts. */
export const buildVideoRenderInput = (
  clip: TimelineClip,
  graph: ClipGraph,
  nodes: Record<string, NodeBase>,
  world: WorldAsset | undefined,
  playhead: number,
  prompt?: string,
): LyraVideoRenderInput => {
  const keyframeNodes = graph.keyframeNodeIds
    .map((nodeId) => nodes[nodeId])
    .filter((node): node is NodeBase => node !== undefined);

  const keyframes: StageKeyframePose[] =
    keyframeNodes.length > 0
      ? keyframeNodes.map((node) => {
          const params = node.parameters as Record<string, unknown>;
          const camera = (params.camera as StageKeyframePose["camera"] | undefined) ?? defaultCamera();
          const objects =
            (params.objects as StageKeyframePose["objects"] | undefined) ?? [];
          return {
            playhead: Number(params.playhead ?? playhead),
            camera,
            objects,
          };
        })
      : [
          {
            playhead,
            camera: defaultCamera(),
            objects: [],
          },
        ];

  return {
    clipId: clip.id,
    prompt,
    keyframes,
    cameraTrajectory: {
      label: clip.cameraTrajectoryNodeId ?? `trajectory-${clip.id}`,
      frameCount: clip.duration,
    },
    worldArtifacts: {
      spatialMemoryPath: world?.spatialMemoryPath ?? "artifacts/spatial_memory/",
      visualLayer3dgsPath: world?.visualLayer3dgsPath ?? world?.previewPath ?? "",
      surfaceMeshPath: world?.surfaceMeshPath ?? world?.previewPath ?? "",
      generatedSegmentPath: world?.generatedSegmentPath,
    },
    memoryCoverage: world?.memoryCoverage ?? 0.5,
  };
};
