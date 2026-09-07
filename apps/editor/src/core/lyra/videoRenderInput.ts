import type { ClipGraph } from "../clipgraph/types";
import type { NodeBase } from "../nodes/types";
import type { TimelineClip } from "../project/types";
import type {
  ShotDirectionKeyframe,
  ShotStagingAnchor,
  StageKeyframePose,
  LyraVideoRenderInput,
} from "../lyra/types";
import type { WorldAsset } from "../world/types";
import { cameraPathParamsFromNode } from "../../domain/graph/cameraPath";
import { lensNodeIdForClip, lensParamsFromNode } from "../../domain/graph/lens";
import { performancePlanFromNode, performancePlanNodeIdForClip } from "../../domain/performance";
import { clipStartFrame } from "../../domain/timeline/timing";
import {
  fullDirectionInvalidation,
  type DirectionChannelInvalidation,
} from "../../domain/direction";
import {
  negotiateDirectionCapabilities,
  type ModelDirectionCapabilities,
} from "../../domain/rendering/capabilities";
import { validateCameraContinuity } from "../../domain/graph/continuity";
import { LYRA_DIRECTION_CAPABILITIES } from "./capabilities";

const defaultCamera = (): StageKeyframePose["camera"] => ({
  position: [2.5, 1.8, 3.2],
  rotation: [0, 0, 0],
  focalLength: 35,
});

const quaternionToEuler = (
  quat: [number, number, number, number],
): [number, number, number] => {
  const [x, y, z, w] = quat;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  return [roll, pitch, Math.atan2(sinyCosp, cosyCosp)];
};

const eulerToQuaternion = (
  euler: [number, number, number],
): [number, number, number, number] => {
  const [x, y, z] = euler;
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
};

const vectorFromRecord = (value: unknown): [number, number, number] | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { x?: unknown; y?: unknown; z?: unknown };
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.z !== "number"
  ) {
    return undefined;
  }
  return [record.x, record.y, record.z];
};

const stagingAnchorFromNode = (node: NodeBase): ShotStagingAnchor | undefined => {
  const position = vectorFromRecord(node.parameters.position);
  const rotation = vectorFromRecord(node.parameters.rotation);
  if (!position || !rotation) {
    return undefined;
  }
  const kind: ShotStagingAnchor["kind"] | undefined =
    node.kind === "ActorPlacementNode"
      ? "actor"
      : node.kind === "PlacementNode"
        ? "prop"
        : node.kind === "LightingRigNode"
          ? "light"
          : undefined;
  if (!kind) {
    return undefined;
  }
  const id =
    typeof node.parameters.worldElementId === "string"
      ? node.parameters.worldElementId
      : typeof node.parameters.mark === "string"
        ? node.parameters.mark
        : typeof node.parameters.prop === "string"
          ? node.parameters.prop
          : typeof node.parameters.lightId === "string"
            ? node.parameters.lightId
            : node.id;
  return { id, kind, position, rotation };
};

const collectStagingAnchors = (
  graph: ClipGraph,
  nodes: Record<string, NodeBase>,
  capturedKeyframes: NodeBase[],
): ShotStagingAnchor[] => {
  const anchors = new Map<string, ShotStagingAnchor>();
  graph.nodeIds.forEach((nodeId) => {
    const node = nodes[nodeId];
    if (!node) {
      return;
    }
    const anchor = stagingAnchorFromNode(node);
    if (anchor) {
      anchors.set(anchor.id, anchor);
    }
  });

  // Reduce captured 3D poses to one static anchor per object. Temporal interpolation is discarded.
  capturedKeyframes
    .slice()
    .sort((a, b) => Number(a.parameters.playhead ?? 0) - Number(b.parameters.playhead ?? 0))
    .forEach((node) => {
      const objects = node.parameters.objects as StageKeyframePose["objects"] | undefined;
      (objects ?? []).forEach((object) => {
        if (!anchors.has(object.id)) {
          anchors.set(object.id, {
            id: object.id,
            kind: object.kind,
            position: object.position,
            rotation: object.rotation,
          });
        }
      });
    });
  return Array.from(anchors.values());
};

/**
 * Build a connector input with an explicit direction contract:
 * 3D data owns the shot, while acting/audio signals come from PerformancePlanNode only.
 */
export const buildVideoRenderInput = (
  clip: TimelineClip,
  graph: ClipGraph,
  nodes: Record<string, NodeBase>,
  world: WorldAsset | undefined,
  playhead: number,
  prompt?: string,
  options?: {
    capabilities?: ModelDirectionCapabilities;
    rerenderScope?: DirectionChannelInvalidation[];
  },
): LyraVideoRenderInput => {
  const capturedKeyframes = graph.keyframeNodeIds
    .map((nodeId) => nodes[nodeId])
    .filter((node): node is NodeBase => node !== undefined);
  const cameraPathNodeId =
    clip.cameraPathNodeId ?? clip.cameraTrajectoryNodeId ?? `node-${clip.id}-trajectory`;
  const cameraPath = cameraPathParamsFromNode(nodes[cameraPathNodeId]?.parameters ?? {});
  const lens = lensParamsFromNode(nodes[lensNodeIdForClip(clip.id)]?.parameters ?? {});
  const performanceNodeId =
    clip.performancePlanNodeId ?? performancePlanNodeIdForClip(clip.id);
  const performancePlan = performancePlanFromNode(nodes[performanceNodeId]?.parameters);
  const capabilities = options?.capabilities ?? LYRA_DIRECTION_CAPABILITIES;

  const shotKeyframes: ShotDirectionKeyframe[] =
    cameraPath.keyframes.length > 0
      ? cameraPath.keyframes.map((keyframe) => ({
          frame: keyframe.frame,
          position: keyframe.position,
          rotationQuaternion: keyframe.rotation,
          focalLengthMm: keyframe.focalLengthMm || lens.focalLengthMm,
          focusDistanceM: keyframe.focusDistanceM ?? lens.focusDistanceM,
          aperture: keyframe.aperture ?? lens.aperture,
        }))
      : capturedKeyframes.map((node) => {
          const params = node.parameters as Record<string, unknown>;
          const camera = (params.camera as StageKeyframePose["camera"] | undefined) ?? defaultCamera();
          return {
            frame: Math.max(0, Number(params.playhead ?? playhead) - clipStartFrame(clip)),
            position: camera.position,
            rotationQuaternion: eulerToQuaternion(camera.rotation),
            focalLengthMm: camera.focalLength || lens.focalLengthMm,
            focusDistanceM: lens.focusDistanceM,
            aperture: lens.aperture,
          };
        });

  if (shotKeyframes.length === 0) {
    const fallback = defaultCamera();
    shotKeyframes.push({
      frame: Math.max(0, playhead - clipStartFrame(clip)),
      position: fallback.position,
      rotationQuaternion: eulerToQuaternion(fallback.rotation),
      focalLengthMm: lens.focalLengthMm,
      focusDistanceM: lens.focusDistanceM,
      aperture: lens.aperture,
    });
  }

  // Legacy connector field remains camera-only. No actor/object keyframe motion is forwarded.
  const keyframes: StageKeyframePose[] = shotKeyframes.map((keyframe) => ({
    playhead: keyframe.frame,
    camera: {
      position: keyframe.position,
      rotation: quaternionToEuler(keyframe.rotationQuaternion),
      focalLength: keyframe.focalLengthMm,
    },
    objects: [],
  }));

  const stagingAnchors = collectStagingAnchors(graph, nodes, capturedKeyframes);
  const enabledSources = performancePlan.sources.filter((source) => source.enabled);
  const capabilityNegotiation = negotiateDirectionCapabilities(
    performancePlan.channelControls,
    capabilities,
    {
      performanceSourceTypes: enabledSources.map((source) => source.type),
      hasFrameAccurateCues: performancePlan.cues.length > 0,
      hasEditedAudio: Boolean(performancePlan.audioGuide?.uri || performancePlan.audioGuide?.assetId),
    },
  );
  const acceptedSourceTypes = new Set(capabilityNegotiation.acceptedPerformanceSourceTypes);
  const continuityValidation = validateCameraContinuity(
    shotKeyframes.map((keyframe) => ({ frame: keyframe.frame, position: keyframe.position })),
    stagingAnchors
      .filter((anchor) => anchor.kind === "actor")
      .map((anchor) => ({ id: anchor.id, position: anchor.position })),
    cameraPath.continuity,
  );
  const rerenderInvalidations = options?.rerenderScope;

  return {
    clipId: clip.id,
    prompt,
    keyframes,
    cameraTrajectory: {
      label: cameraPathNodeId,
      frameCount: clip.duration,
    },
    worldArtifacts: {
      spatialMemoryPath: world?.spatialMemoryPath ?? "artifacts/spatial_memory/",
      visualLayer3dgsPath: world?.visualLayer3dgsPath ?? world?.previewPath ?? "",
      surfaceMeshPath: world?.surfaceMeshPath ?? world?.previewPath ?? "",
      generatedSegmentPath: world?.generatedSegmentPath,
    },
    memoryCoverage: world?.memoryCoverage ?? 0.5,
    rerenderScope: {
      mode: rerenderInvalidations?.length ? "partial" : "full",
      invalidations: rerenderInvalidations?.length
        ? rerenderInvalidations
        : fullDirectionInvalidation(),
    },
    directionContract: {
      version: 2,
      separationPolicy: "shot_and_performance",
      capabilityNegotiation,
      shot: {
        source: "3d_previs",
        cameraPathNodeId,
        keyframes: shotKeyframes,
        lens,
        lookAtTargetElementId: cameraPath.lookAtTargetElementId,
        continuity: cameraPath.continuity,
        continuityValidation,
        stagingAnchors,
        allowedSignals: [
          "composition",
          "camera_motion",
          "lens",
          "spatial_staging",
          "eyeline",
          "screen_direction",
          "action_boundaries",
        ],
        ignoredCharacterSignals: [
          "body_mechanics",
          "contact",
          "facial_performance",
          "cloth_motion",
          "previs_interpolation",
        ],
      },
      performance: {
        source: "external_performance",
        planNodeId: performanceNodeId,
        sources: enabledSources
          .filter((source) => acceptedSourceTypes.has(source.type))
          .map(({ enabled: _enabled, ...source }) => source),
        cues: performancePlan.cues,
        audioGuide:
          capabilityNegotiation.editedAudio === "degraded"
            ? undefined
            : performancePlan.audioGuide,
      },
    },
  };
};
