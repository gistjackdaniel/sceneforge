import type { EnvironmentView } from "../../domain/shot";
import type { WorldAsset } from "../../domain/worlds/types";
import { resolveShotWorldRevision } from "../../domain/worlds/importedShotWorld";

const usable = (value: string | undefined) => Boolean(value && value !== "missing");

/** Geometry the model may see. Proxy worlds stay labeled and carry no geometry URI. */
export const environmentFromWorld = (world: WorldAsset | undefined, revisionId?: string): EnvironmentView | undefined => {
  if (!world) return undefined;
  if (revisionId) {
    const revision = resolveShotWorldRevision(world, revisionId);
    return revision ? { worldId: world.id, representation: "mesh", geometryUri: revision.uri, coordinateSystem: "Y_UP", unitScaleMeters: 1 } : undefined;
  }
  const proxy = world.representation === "image_based_proxy" || world.representation === "video_based_proxy";
  const geometryUri = [world.surfaceMeshPath, world.usdPath, world.rootUri].find(usable);
  return {
    worldId: world.id,
    representation: world.representation,
    geometryUri: proxy ? undefined : geometryUri,
    coordinateSystem: world.coordinateSystem,
    unitScaleMeters: world.unitScaleMeters > 0 ? world.unitScaleMeters : 1,
    ...(world.handedness ? { handedness: world.handedness } : {}),
    ...(world.frontAxis ? { frontAxis: world.frontAxis } : {}),
  };
};
