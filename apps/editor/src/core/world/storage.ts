import type { WorldAsset } from "./types";

export const createWorldDirectoryManifest = (world: WorldAsset) => ({
  id: world.id,
  name: world.name,
  files: [
    world.usdPath,
    world.semanticsPath,
    world.navmeshPath,
    world.previewPath,
  ],
  proxyKind: world.proxyKind,
});

export const serializeWorld = (world: WorldAsset): string => JSON.stringify(world, null, 2);

export const deserializeWorld = (raw: string): WorldAsset => JSON.parse(raw) as WorldAsset;
