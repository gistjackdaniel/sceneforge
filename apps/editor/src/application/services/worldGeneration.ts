import { createAssetRecord } from "../../domain/assets/registry";
import type { AssetRecord } from "../../domain/assets/types";
import type { CameraPathParams } from "../../domain/graph/cameraPath";
import { upsertCameraKeyframe } from "../../domain/graph/cameraPath";
import type { ModelExecutionRecord } from "../../domain/worlds/modelExecution";
import { packageWorldFromExecution } from "../../domain/worlds/packageWorld";
import type { WorldAsset } from "../../domain/worlds/types";
import type { Project } from "../../domain/project/types";
import type { WorldGenerationArtifacts } from "./worldGenerationRequest";

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
    thumbnailUri: input.uri,
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
    artifacts: WorldGenerationArtifacts;
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

export const findReusableWorldExecution = (
  project: Project,
  input: {
    inputAssetIds: string[];
    connectorId: string;
    task: string;
    prompt?: string;
    seed?: number;
  },
): { world: WorldAsset; execution: ModelExecutionRecord } | undefined => {
  const executions = Object.values(project.modelExecutions ?? {});
  const match = executions.find((execution) => {
    if (execution.status !== "completed") {
      return false;
    }
    if (execution.connectorId !== input.connectorId || execution.task !== input.task) {
      return false;
    }
    if (!input.inputAssetIds.every((id) => execution.inputAssetIds.includes(id))) {
      return false;
    }
    if (input.prompt !== undefined && execution.parameters.prompt !== input.prompt) {
      return false;
    }
    if (input.seed !== undefined && execution.seed !== input.seed) {
      return false;
    }
    return true;
  });
  if (!match) {
    return undefined;
  }
  const world = Object.values(project.worlds).find((item) => item.generatedBy?.id === match.id);
  if (!world) {
    return undefined;
  }
  return { world, execution: match };
};

export const snapshotProjectIdentity = (project: Project): string =>
  JSON.stringify({
    worldIds: Object.keys(project.worlds).sort(),
    assetIds: Object.keys(project.assets ?? {}).sort(),
    executionIds: Object.keys(project.modelExecutions ?? {}).sort(),
    clipLinks: Object.fromEntries(
      Object.values(project.clips).map((clip) => [clip.id, clip.linkedWorldId ?? ""]),
    ),
    nodeIds: Object.keys(project.nodes).sort(),
  });

export type { WorldAsset };
