import { normalizeWorldAsset } from "../../domain/worlds/normalize";
import type { WorldAsset } from "../../domain/worlds/types";
import {
  createWorldDirectoryManifest,
  createWorldElementsPackage,
  deserializeWorldDirectoryManifest,
  deserializeWorldElements,
  serializeWorldDirectoryManifest,
  serializeWorldElements,
  type WorldDirectoryManifest,
} from "../../core/world/storage";
import { writeAtomicFile } from "../../infrastructure/persistence";

const pathJoin = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

const filePathFor = (dirPath: string, file: string): string =>
  // Allow both absolute file-system paths in tests and editor/public URIs in app
  dirPath.startsWith("/") ? `${dirPath}/${file}` : pathJoin(dirPath, file);

const pickArtifact = (files: string[], matcher: (name: string) => boolean): string => {
  const hit = files.find(matcher);
  return hit ?? "";
};

export const saveWorldPackageToDirectory = async (
  dirPath: string,
  world: WorldAsset,
): Promise<void> => {
  const manifest = createWorldDirectoryManifest(world);
  const elements = createWorldElementsPackage(world);
  await writeAtomicFile(filePathFor(dirPath, "manifest.json"), serializeWorldDirectoryManifest(manifest));
  await writeAtomicFile(filePathFor(dirPath, "elements.json"), serializeWorldElements(elements));
};

export const loadWorldPackageFromDirectory = async (dirPath: string): Promise<WorldAsset> => {
  const fs = await import("node:fs/promises");
  const manifestRaw = await fs.readFile(filePathFor(dirPath, "manifest.json"), "utf8");
  const elementsRaw = await fs.readFile(filePathFor(dirPath, "elements.json"), "utf8");
  const manifest = deserializeWorldDirectoryManifest(manifestRaw);
  const elements = deserializeWorldElements(elementsRaw);

  const files = manifest.files ?? [];
  const usdRel = pickArtifact(files, (f) => /(^|\/)world\.(usd|usda|usdc)$/i.test(f));
  const semanticsRel = pickArtifact(files, (f) => /(^|\/)semantics\.json$/i.test(f));
  const navmeshRel = pickArtifact(files, (f) => /(^|\/)navmesh\.(bin|navmesh)$/i.test(f));
  const previewRel = pickArtifact(
    files,
    (f) => /(^|\/)(preview\.(glb|gltf|ply)|mesh\.(glb|gltf)|splats?\.ply|points?\.ply)$/i.test(f),
  );

  // Prefer manifest.rootUri for app-relative references; fall back to dirPath
  const rootUri = manifest.rootUri || dirPath;
  return normalizeWorldAsset({
    id: manifest.id,
    name: manifest.name,
    proxyKind: manifest.proxyKind,
    representation: manifest.representation,
    rootUri,
    previewUri: previewRel ? pathJoin(rootUri, previewRel) : undefined,
    usdPath: usdRel ? pathJoin(rootUri, usdRel) : "",
    semanticsPath: semanticsRel ? pathJoin(rootUri, semanticsRel) : "",
    navmeshPath: navmeshRel ? pathJoin(rootUri, navmeshRel) : "",
    previewPath: previewRel ? pathJoin(rootUri, previewRel) : "",
    elements: elements.elements ?? [],
    props: [],
  });
};

export const saveWorldElementsToDirectory = async (
  dirPath: string,
  elements: ReturnType<typeof createWorldElementsPackage>,
): Promise<void> => {
  await writeAtomicFile(filePathFor(dirPath, "elements.json"), serializeWorldElements(elements));
};

export const upsertWorldElementsInDirectory = async (
  dirPath: string,
  worldId: string,
  incoming: Array<{ id: string; name: string; kind: string; description?: string }>,
): Promise<void> => {
  const fs = await import("node:fs/promises");
  const elementsPath = filePathFor(dirPath, "elements.json");
  let current = { version: 1, worldId, elements: [] as Array<{ id: string; name: string; kind: string; description?: string }> };
  try {
    const raw = await fs.readFile(elementsPath, "utf8");
    current = deserializeWorldElements(raw);
  } catch {
    // file may not exist yet — proceed with empty
  }
  const byId = new Map(current.elements.map((e) => [e.id, e]));
  incoming.forEach((e) => {
    const prev = byId.get(e.id);
    byId.set(e.id, { ...prev, ...e });
  });
  const next = { version: 1, worldId, elements: Array.from(byId.values()) };
  await writeAtomicFile(elementsPath, serializeWorldElements(next));
};

