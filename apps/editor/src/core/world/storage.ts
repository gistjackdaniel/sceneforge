import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import type { WorldAsset } from "../../domain/worlds/types";

export const createWorldDirectoryManifest = (world: WorldAsset) => ({
  id: world.id,
  name: world.name,
  files: [world.usdPath, world.semanticsPath, world.navmeshPath, world.previewPath],
  proxyKind: world.proxyKind,
  representation: world.representation,
  rootUri: world.rootUri,
});

export const serializeWorld = (world: WorldAsset): string => JSON.stringify(world, null, 2);

export const deserializeWorld = (raw: string): WorldAsset => {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("id" in parsed) || !("name" in parsed)) {
    throw new Error("Invalid world payload.");
  }
  const record = parsed as { id: string; name: string } & Partial<WorldAsset>;
  return normalizeWorldAsset(record);
};
