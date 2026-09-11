import { describe, it, expect } from "vitest";
import { createMeshExampleWorld } from "./sampleWorlds";
import { loadWorldPackageFromDirectory, saveWorldPackageToDirectory } from "../../application/services/worldPackaging";
import { normalizeWorldAsset } from "./normalize";
import { readFile } from "node:fs/promises";

const tmpDir = async (): Promise<string> => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-world-"));
  return dir;
};

describe("world package save/load", () => {
  it("round-trips manifest.json and elements.json", async () => {
    const world = createMeshExampleWorld();
    const dir = await tmpDir();

    await saveWorldPackageToDirectory(dir, world);

    // Sanity: files created
    const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
    const elements = JSON.parse(await readFile(`${dir}/elements.json`, "utf8"));
    expect(manifest.id).toBe(world.id);
    expect(elements.worldId).toBe(world.id);
    expect(Array.isArray(elements.elements)).toBe(true);
    expect(elements.version).toBe(1);

    const loaded = await loadWorldPackageFromDirectory(dir);
    const expected = normalizeWorldAsset(world);
    expect(loaded.id).toBe(expected.id);
    expect(loaded.name).toBe(expected.name);
    expect(loaded.proxyKind).toBe(expected.proxyKind);
    expect(loaded.representation).toBe(expected.representation);
    expect(loaded.rootUri).toBe(expected.rootUri);
    // Artifact paths reconstructed with rootUri + relative
    expect(loaded.usdPath.endsWith("/world.usda")).toBe(true);
    expect(loaded.semanticsPath.endsWith("/semantics.json")).toBe(true);
    expect(loaded.navmeshPath.endsWith("/navmesh.bin")).toBe(true);
    expect(loaded.previewPath.endsWith("/preview.glb")).toBe(true);
    // Elements preserved
    expect(loaded.elements.map((e) => e.id)).toEqual(expected.elements.map((e) => e.id));
  });
});

