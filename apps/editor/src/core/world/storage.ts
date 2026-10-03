import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import type { WorldAsset, WorldElement } from "../../domain/worlds/types";
/**
 * On-disk World package: manifest.json alongside elements.json and engine artifacts.
 * - manifest.json describes high-level WorldAsset identity and file layout
 * - elements.json carries serialized WorldElement[] independent of engine files
 */
export interface WorldDirectoryManifest {
  id: string;
  name: string;
  proxyKind: WorldAsset["proxyKind"];
  representation: WorldAsset["representation"];
  /** Directory-relative file paths for engine artifacts (e.g. world.usda, preview.glb, semantics.json, navmesh.bin) */
  files: string[];
  /** Package root (editor/public-relative URI or absolute path for Node tests) */
  rootUri: string;
}

export interface WorldElementsPackage {
  version: number;
  worldId: string;
  elements: WorldElement[];
}

export const createWorldDirectoryManifest = (world: WorldAsset): WorldDirectoryManifest => {
  // Persist artifact file names relative to the package root when possible
  const relativize = (path: string): string => {
    try {
      // If already relative to the rootUri prefix, strip that prefix
      return path.startsWith(world.rootUri + "/") ? path.slice(world.rootUri.length + 1) : path;
    } catch {
      return path;
    }
  };
  return {
    id: world.id,
    name: world.name,
    files: [world.usdPath, world.semanticsPath, world.navmeshPath, world.previewPath]
      .filter((p) => typeof p === "string" && p.length > 0)
      .map(relativize),
    proxyKind: world.proxyKind,
    representation: world.representation,
    rootUri: world.rootUri,
  };
};

export const createWorldElementsPackage = (world: Pick<WorldAsset, "id" | "elements">): WorldElementsPackage => ({
  version: 1,
  worldId: world.id,
  elements: [...(world.elements ?? [])],
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

export const serializeWorldDirectoryManifest = (manifest: WorldDirectoryManifest): string =>
  JSON.stringify(manifest, null, 2);

export const deserializeWorldDirectoryManifest = (raw: string): WorldDirectoryManifest => {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid world manifest payload.");
  }
  const m = parsed as Partial<WorldDirectoryManifest>;
  if (
    typeof m.id !== "string" ||
    typeof m.name !== "string" ||
    !Array.isArray(m.files) ||
    typeof m.proxyKind !== "string" ||
    typeof m.representation !== "string" ||
    typeof m.rootUri !== "string"
  ) {
    throw new Error("Invalid world manifest fields.");
  }
  return {
    id: m.id,
    name: m.name,
    files: m.files.filter((p): p is string => typeof p === "string"),
    proxyKind: m.proxyKind as WorldAsset["proxyKind"],
    representation: m.representation as WorldAsset["representation"],
    rootUri: m.rootUri,
  };
};

export const serializeWorldElements = (pkg: WorldElementsPackage): string => JSON.stringify(pkg, null, 2);

export const deserializeWorldElements = (raw: string): WorldElementsPackage => {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid world elements payload.");
  }
  const m = parsed as Partial<WorldElementsPackage>;
  if (typeof m.worldId !== "string" || !Array.isArray(m.elements)) {
    throw new Error("Invalid world elements fields.");
  }
  return {
    version: typeof m.version === "number" ? m.version : 1,
    worldId: m.worldId,
    elements: m.elements as WorldElement[],
  };
};
