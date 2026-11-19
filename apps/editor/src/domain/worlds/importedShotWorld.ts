import { z } from "zod";
import { normalizeWorldAsset } from "./normalize";
import type { WorldAsset } from "./types";

export const SHOT_WORLD_MAX_BYTES = 128 * 1024 * 1024;
const CLASSROOM_URI = "worlds/phase1-classroom/room.glb";
const CLASSROOM_HASH = "3732f28bbc05f47512648abc5f5877bb4af004394676a90f301139e3ddb80e6c";

export const importedWorldUri = (contentHash: string): string => `worlds/imported/${contentHash}.glb`;
export const importedWorldHash = (uri: string): string | undefined =>
  /^worlds\/imported\/([0-9a-f]{64})\.glb$/.exec(uri)?.[1];

export const importedShotWorldSchema = z.object({
  name: z.string().trim().min(1).max(120),
  uri: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: z.number().int().positive().max(SHOT_WORLD_MAX_BYTES),
  meshCount: z.number().int().positive(),
  texturedMaterialCount: z.number().int().nonnegative(),
}).refine(({ uri, contentHash }) => importedWorldHash(uri) === contentHash
  || (uri === CLASSROOM_URI && contentHash === CLASSROOM_HASH), "씬 메시의 상대 URI와 해시가 일치해야 합니다.");

export type ImportedShotWorld = z.infer<typeof importedShotWorldSchema>;

export const PHASE1_CLASSROOM_WORLD: ImportedShotWorld = {
  name: "Classroom",
  uri: CLASSROOM_URI,
  contentHash: CLASSROOM_HASH,
  byteLength: 16995496,
  meshCount: 301,
  texturedMaterialCount: 60,
};

export const shotWorldRevisionId = (imported: ImportedShotWorld): string => `sha256-${imported.contentHash}`;

type WorldRevision = NonNullable<WorldAsset["versions"]>[number];

const importedRevision = (revision: WorldRevision | undefined): ImportedShotWorld | undefined => {
  if (!revision) return undefined;
  const parsed = importedShotWorldSchema.safeParse(revision.artifacts);
  return parsed.success && shotWorldRevisionId(parsed.data) === revision.jobId ? parsed.data : undefined;
};

/** Resolve a shot pin without reading the world's current geometry. */
export const resolveShotWorldRevision = (
  world: WorldAsset | undefined,
  revisionId: string,
): ImportedShotWorld | undefined => importedRevision(world?.versions?.find((version) => version.jobId === revisionId));

const placeRevision = (
  world: WorldAsset,
  imported: ImportedShotWorld,
  version: number,
  timestamp: string,
): WorldAsset => ({
  ...world,
  name: imported.name,
  representation: "mesh",
  coordinateSystem: "Y_UP",
  handedness: "right",
  frontAxis: "+Z",
  unitScaleMeters: 1,
  rootUri: imported.uri,
  surfaceMeshPath: imported.uri,
  previewUri: imported.uri,
  previewPath: imported.uri,
  version,
  updatedAt: timestamp,
});

/** Append a distinct imported GLB under the same world ID. Reimporting identical bytes selects the existing revision. */
export const registerShotWorld = (
  worldId: string,
  imported: ImportedShotWorld,
  timestamp: string,
  previous?: WorldAsset,
): WorldAsset => {
  const descriptor = importedShotWorldSchema.parse(imported);
  const revisionId = shotWorldRevisionId(descriptor);
  const world = previous ?? normalizeWorldAsset({ id: worldId, name: descriptor.name, createdAt: timestamp });
  const existing = world.versions?.find((revision) => revision.jobId === revisionId);
  const stored = importedRevision(existing);
  if (existing && stored) {
    return existing.version === world.version ? world : placeRevision(world, stored, existing.version, timestamp);
  }
  const history = world.versions ?? [];
  const latest = history.reduce((highest, revision) => Math.max(highest, revision.version), previous?.version ?? 0);
  const version = latest + 1;
  return {
    ...placeRevision(world, descriptor, version, timestamp),
    versions: [...history, { version, jobId: revisionId, registeredAt: timestamp, artifacts: descriptor }],
  };
};

/** Select a retained imported revision while keeping all revision history and the persistent world ID. */
export const revertShotWorld = (world: WorldAsset, version: number, timestamp: string): WorldAsset | undefined => {
  const descriptor = importedRevision(world.versions?.find((revision) => revision.version === version));
  if (!descriptor) return undefined;
  return world.version === version ? world : placeRevision(world, descriptor, version, timestamp);
};
