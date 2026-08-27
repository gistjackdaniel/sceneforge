import { createAssetRecord } from "../../domain/assets/registry";
import type { AssetRecord } from "../../domain/assets/types";
import type { CameraPathParams } from "../../domain/graph/cameraPath";
import { upsertCameraKeyframe } from "../../domain/graph/cameraPath";
import type { ModelExecutionRecord } from "../../domain/worlds/modelExecution";
import { packageWorldFromExecution } from "../../domain/worlds/packageWorld";
import type { WorldAsset } from "../../domain/worlds/types";
import type { Project } from "../../domain/project/types";

export const registerSourceImageAsset = (
  assets: Record<string, AssetRecord>,
  input: { id: string; name: string; uri: string },
): Record<string, AssetRecord> => ({
  ...assets,
  [input.id]: createAssetRecord({
    id: input.id,
    type: "image",
    name: input.name,
    uri: input.uri,
    metadata: { role: "world_source" },
  }),
});

export const applyTrajectoryToCameraPath = (
  existing: Record<string, unknown>,
  label: string,
  frameCount: number,
): CameraPathParams =>
  upsertCameraKeyframe(
    {
      keyframes: Array.isArray(existing.keyframes) ? (existing.keyframes as CameraPathParams["keyframes"]) : [],
      interpolation: "linear",
      label,
      frameCount,
    },
    {
      frame: 0,
      position: [2.5, 1.8, 3.2],
      rotation: [0, 0, 0, 1],
      focalLengthMm: 35,
    },
  );

export const persistWorldGeneration = (
  project: Project,
  input: {
    worldId: string;
    name: string;
    description: string;
    execution: ModelExecutionRecord;
    artifacts: {
      generatedSegmentPath?: string;
      spatialMemoryPath?: string;
      visualLayer3dgsPath?: string;
      surfaceMeshPath?: string;
      navmeshPath?: string;
      collisionMeshPath?: string;
      memoryCoverage?: number;
      generatedAreaRatio?: number;
    };
  },
): Project => {
  const packaged = packageWorldFromExecution({
    worldId: input.worldId,
    name: input.name,
    description: input.description,
    execution: input.execution,
    artifacts: input.artifacts,
    existingWorld: project.worlds[input.worldId],
    existingAssets: project.assets ?? {},
  });
  return {
    ...project,
    worlds: { ...project.worlds, [packaged.world.id]: packaged.world },
    assets: packaged.assets,
    modelExecutions: {
      ...(project.modelExecutions ?? {}),
      [packaged.execution.id]: packaged.execution,
    },
  };
};

export type { WorldAsset };
