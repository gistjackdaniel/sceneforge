import type { WorldAsset, WorldElement } from "./types";
import { SCENE_COORDINATE_CONTRACT, sourceAxesFromWorldAsset, IDENTITY_TRANSFORM, type SourceAxes } from "./coordinates";
import { WorldDomainError } from "./errors";
import {
  legacyActorInstanceId,
  legacyElementObjectInstanceId,
  legacyPropInstanceId,
  legacyRevisionId,
  legacyWorldAssetId,
  persistentIdSchema,
  sanitizeLegacyToken,
} from "./ids";
import {
  sceneStateSchema,
  SMPLX_PART_JOINT,
  type ActorInstance,
  type Asset,
  type AssetRevision,
  type LegacyRef,
  type ObjectInstance,
  type SceneState,
} from "./sceneState";

const NEUTRAL_BETAS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const requirePersistentId = (id: string): string => {
  const parsed = persistentIdSchema.safeParse(id);
  if (!parsed.success) throw new WorldDomainError("invalid_id", "A migrated id is not a valid persistent id.");
  return parsed.data;
};

const localizedNamesOf = (
  input: WorldElement["localizedNames"] | WorldAsset["localizedNames"],
): Record<string, string> => {
  const names: Record<string, string> = {};
  if (!input) return names;
  for (const [locale, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0) names[locale] = value;
  }
  return names;
};

const revisionUri = (
  artifacts: object | undefined,
  fallback: string,
): string => {
  if (artifacts && "surfaceMeshPath" in artifacts && typeof artifacts.surfaceMeshPath === "string") {
    if (artifacts.surfaceMeshPath.length > 0) return artifacts.surfaceMeshPath;
  }
  return fallback;
};

type WorldRevisionSource = {
  revision: number;
  createdAt: string;
  uri: string;
  jobId?: string;
};

const worldRevisionSources = (world: WorldAsset): WorldRevisionSource[] => {
  const versions = world.versions ?? [];
  if (versions.length > 0) {
    return versions.map((version) => ({
      revision: version.version,
      createdAt: version.registeredAt,
      uri: revisionUri(version.artifacts, world.rootUri),
      jobId: version.jobId,
    }));
  }
  return [{ revision: world.version, createdAt: world.updatedAt || world.createdAt, uri: world.rootUri }];
};

const fingerprint = (assetId: string, revision: number, uri: string): string =>
  `legacy-fingerprint:${assetId}:${revision}:${uri}`;

const makeRevision = (input: {
  revisionId: string;
  assetId: string;
  revision: number;
  parentRevisionId?: string;
  uri: string;
  sourceAxes: SourceAxes;
  createdAt: string;
  legacy?: AssetRevision["legacy"];
  rig?: AssetRevision["rig"];
  note?: string;
}): AssetRevision => ({
  revisionId: requirePersistentId(input.revisionId),
  assetId: input.assetId,
  revision: input.revision,
  parentRevisionId: input.parentRevisionId,
  contentHash: fingerprint(input.assetId, input.revision, input.uri),
  uri: input.uri,
  sourceAxes: input.sourceAxes,
  rig: input.rig,
  legacy: input.legacy,
  createdAt: input.createdAt,
  note: input.note,
});

const placeholderAxes = (sourceAxes: SourceAxes): SourceAxes => sourceAxes;

/**
 * Build the world scene for one `WorldAsset`.
 * Element and prop ids are deterministic, so a second call on the same asset returns the same instance ids.
 * `WorldAsset.id` and `WorldElement.id` are not rewritten. The world asset id reuses `asset-${world.id}`.
 * Initial pins point at the revisions that exist on this call. Later world regenerations must go through
 * `adoptRegeneratedWorld`, which appends revisions without moving those pins.
 * `room`, `zone`, `camera_anchor`, `light_socket`, and `material_slot` stay elements and are not instanced.
 * No I/O. Does not mutate `world`.
 */
export const migrateWorldToSceneState = (world: WorldAsset): SceneState => {
  const worldId = requirePersistentId(world.id);
  const sourceAxes = sourceAxesFromWorldAsset(world);
  const createdAt = world.createdAt;
  const worldAssetId = requirePersistentId(legacyWorldAssetId(worldId));
  const used = new Set<string>();
  const claim = (id: string): string => {
    const persistent = requirePersistentId(id);
    if (used.has(persistent)) throw new WorldDomainError("duplicate_legacy_id", "Legacy instance ids collided.");
    used.add(persistent);
    return persistent;
  };

  const assets: Record<string, Asset> = {};
  const revisions: Record<string, AssetRevision> = {};
  const actors: Record<string, ActorInstance> = {};
  const objects: Record<string, ObjectInstance> = {};

  const addAsset = (asset: Asset, assetRevisions: AssetRevision[]): void => {
    claim(asset.id);
    for (const revision of assetRevisions) claim(revision.revisionId);
    assets[asset.id] = asset;
    for (const revision of assetRevisions) revisions[revision.revisionId] = revision;
  };

  const sources = worldRevisionSources(world);
  const worldRevisions: AssetRevision[] = [];
  sources.forEach((source, index) => {
    const revisionId = legacyRevisionId(worldId, source.revision);
    const parent = worldRevisions[index - 1];
    worldRevisions.push(
      makeRevision({
        revisionId,
        assetId: worldAssetId,
        revision: source.revision,
        parentRevisionId: parent?.revisionId,
        uri: source.uri,
        sourceAxes,
        createdAt: source.createdAt,
        legacy: { assetRecordId: worldAssetId, worldVersion: source.revision },
        note: source.jobId ? `lyra:${source.jobId}` : undefined,
      }),
    );
  });
  const worldHead = worldRevisions[worldRevisions.length - 1];
  if (!worldHead) throw new WorldDomainError("missing_revision", "World asset has no revision.");
  addAsset(
    {
      id: worldAssetId,
      kind: "world",
      name: world.name,
      aliases: [...(world.aliases ?? [])],
      localizedNames: localizedNamesOf(world.localizedNames),
      headRevisionId: worldHead.revisionId,
      revisionIds: worldRevisions.map((revision) => revision.revisionId),
    },
    worldRevisions,
  );

  const actorMarks = (world.elements ?? []).filter((element) => element.kind === "actor_mark");
  if (actorMarks.length > 0) {
    const characterId = requirePersistentId(`ast_legacy_${sanitizeLegacyToken(worldId)}__character_neutral`);
    const characterRevisionId = requirePersistentId(
      `rev_legacy_${sanitizeLegacyToken(worldId)}__character_neutral_v1`,
    );
    const characterRevision = makeRevision({
      revisionId: characterRevisionId,
      assetId: characterId,
      revision: 1,
      uri: "placeholder://smplx/neutral",
      sourceAxes: placeholderAxes(sourceAxes),
      createdAt,
      rig: { skeleton: "smplx", partMap: { ...SMPLX_PART_JOINT } },
      legacy: { assetRecordId: characterId },
      note: "placeholder until a rigged character asset is bound",
    });
    addAsset(
      {
        id: characterId,
        kind: "character",
        name: "SMPL-X neutral",
        aliases: [],
        localizedNames: {},
        headRevisionId: characterRevisionId,
        revisionIds: [characterRevisionId],
      },
      [characterRevision],
    );
    for (const element of actorMarks) {
      const id = claim(legacyActorInstanceId(worldId, element.id));
      const legacy: LegacyRef = { kind: "world_element", worldId, elementId: element.id };
      actors[id] = {
        id,
        type: "actor",
        label: element.name,
        aliases: [...(element.aliases ?? [])],
        localizedNames: localizedNamesOf(element.localizedNames),
        assetRef: { assetId: characterId, revisionId: characterRevisionId },
        restTransform: IDENTITY_TRANSFORM,
        legacyRefs: [legacy],
        skeleton: { model: "smplx", gender: "neutral", betas: [...NEUTRAL_BETAS] },
      };
    }
  }

  for (const element of world.elements ?? []) {
    if (element.kind !== "socket") continue;
    const assetId = requirePersistentId(
      `ast_legacy_${sanitizeLegacyToken(worldId)}__socket_${sanitizeLegacyToken(element.id)}`,
    );
    const revisionId = requirePersistentId(
      `rev_legacy_${sanitizeLegacyToken(worldId)}__socket_${sanitizeLegacyToken(element.id)}_v1`,
    );
    const revision = makeRevision({
      revisionId,
      assetId,
      revision: 1,
      uri: `placeholder://socket/${sanitizeLegacyToken(element.id)}`,
      sourceAxes,
      createdAt,
      legacy: { assetRecordId: assetId },
    });
    addAsset(
      {
        id: assetId,
        kind: "prop",
        name: element.name,
        aliases: [...(element.aliases ?? [])],
        localizedNames: localizedNamesOf(element.localizedNames),
        headRevisionId: revisionId,
        revisionIds: [revisionId],
      },
      [revision],
    );
    const id = claim(legacyElementObjectInstanceId(worldId, element.id));
    objects[id] = {
      id,
      type: "object",
      role: "prop",
      label: element.name,
      aliases: [...(element.aliases ?? [])],
      localizedNames: localizedNamesOf(element.localizedNames),
      assetRef: { assetId, revisionId },
      restTransform: IDENTITY_TRANSFORM,
      legacyRefs: [{ kind: "world_element", worldId, elementId: element.id }],
      motionMode: "static",
      attachments: [],
    };
  }

  const propOccurrences = new Map<string, number>();
  const propAssets = new Map<string, { assetId: string; revisionId: string }>();
  for (const propName of world.props ?? []) {
    if (propName.trim().length === 0) continue;
    const token = sanitizeLegacyToken(propName);
    const occurrence = (propOccurrences.get(token) ?? 0) + 1;
    propOccurrences.set(token, occurrence);
    let propAsset = propAssets.get(token);
    if (!propAsset) {
      const assetId = requirePersistentId(`ast_legacy_${sanitizeLegacyToken(worldId)}__prop_${token}`);
      const revisionId = requirePersistentId(`rev_legacy_${sanitizeLegacyToken(worldId)}__prop_${token}_v1`);
      const revision = makeRevision({
        revisionId,
        assetId,
        revision: 1,
        uri: `placeholder://prop/${token}`,
        sourceAxes,
        createdAt,
        legacy: { assetRecordId: assetId },
      });
      addAsset(
        {
          id: assetId,
          kind: "prop",
          name: propName,
          aliases: [],
          localizedNames: {},
          headRevisionId: revisionId,
          revisionIds: [revisionId],
        },
        [revision],
      );
      propAsset = { assetId, revisionId };
      propAssets.set(token, propAsset);
    }
    const id = claim(legacyPropInstanceId(worldId, propName, occurrence));
    objects[id] = {
      id,
      type: "object",
      role: "prop",
      label: propName,
      aliases: [],
      localizedNames: {},
      assetRef: { assetId: propAsset.assetId, revisionId: propAsset.revisionId },
      restTransform: IDENTITY_TRANSFORM,
      legacyRefs: [{ kind: "world_prop_name", worldId, propName }],
      motionMode: "static",
      attachments: [],
    };
  }

  return finish({
    schemaVersion: 1,
    contract: SCENE_COORDINATE_CONTRACT,
    worldId,
    setAssetRef: { assetId: worldAssetId, revisionId: worldHead.revisionId },
    assets,
    revisions,
    actors,
    objects,
  });
};

const finish = (input: unknown): SceneState => {
  const parsed = sceneStateSchema.safeParse(input);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new WorldDomainError(
      "invalid_scene",
      path.length > 0 ? `Migrated scene state is invalid (${path}).` : "Migrated scene state is invalid.",
    );
  }
  return parsed.data;
};

/**
 * Keep instance ids when `registerWorldFromLyraOutput` appends a world revision.
 * New world revisions are appended. Instance pins, including `setAssetRef`, stay where they were.
 * Elements and prop names that were not in the scene gain instances. Missing elements are not tombstoned.
 * Does not mutate either argument.
 */
export const adoptRegeneratedWorld = (scene: SceneState, world: WorldAsset): SceneState => {
  if (scene.worldId !== world.id) {
    throw new WorldDomainError("world_mismatch", "Regenerated world does not match the scene.");
  }
  const fresh = migrateWorldToSceneState(world);
  const revisions = { ...scene.revisions };
  for (const [id, revision] of Object.entries(fresh.revisions)) {
    const current = revisions[id];
    if (!current) {
      revisions[id] = revision;
      continue;
    }
    if (current.contentHash !== revision.contentHash || current.uri !== revision.uri) {
      throw new WorldDomainError("revision_immutable", "An existing asset revision changed.");
    }
  }
  const assets = { ...scene.assets };
  for (const [id, asset] of Object.entries(fresh.assets)) {
    const current = assets[id];
    if (!current) {
      assets[id] = asset;
      continue;
    }
    const revisionIds = [...current.revisionIds];
    for (const revisionId of asset.revisionIds) {
      if (!revisionIds.includes(revisionId)) revisionIds.push(revisionId);
    }
    const headRevisionId = revisionIds.reduce((best, revisionId) => {
      const next = revisions[revisionId];
      const previous = revisions[best];
      if (!next || !previous) return best;
      return next.revision > previous.revision ? revisionId : best;
    }, current.headRevisionId);
    assets[id] = { ...current, revisionIds, headRevisionId };
  }
  const actors = { ...scene.actors };
  for (const [id, actor] of Object.entries(fresh.actors)) {
    if (!actors[id]) actors[id] = actor;
  }
  const objects = { ...scene.objects };
  for (const [id, object] of Object.entries(fresh.objects)) {
    if (!objects[id]) objects[id] = object;
  }
  return finish({ ...scene, assets, revisions, actors, objects });
};

const matchesLegacy = (ref: LegacyRef, query: { worldId: string; elementId?: string; propName?: string }): boolean => {
  if (ref.kind === "world_element" && query.elementId !== undefined) {
    return ref.worldId === query.worldId && ref.elementId === query.elementId;
  }
  if (ref.kind === "world_prop_name" && query.propName !== undefined) {
    return ref.worldId === query.worldId && ref.propName === query.propName;
  }
  return false;
};

/**
 * Resolve a legacy element id to the instance created for it.
 * Returns undefined when that element was not instanced (`room`, `light_socket`, …).
 * Prop names can repeat, so use `instanceIdsForLegacyProp` for those.
 */
export const instanceIdForLegacyElement = (
  scene: SceneState,
  worldId: string,
  elementId: string,
): string | undefined => {
  const instances = [...Object.values(scene.actors), ...Object.values(scene.objects)];
  return instances.find((instance) =>
    instance.legacyRefs.some((ref) => matchesLegacy(ref, { worldId, elementId })),
  )?.id;
};

/** Every instance migrated from a prop name, in scene order. Duplicate names return more than one id. */
export const instanceIdsForLegacyProp = (scene: SceneState, worldId: string, propName: string): string[] =>
  Object.values(scene.objects)
    .filter((instance) => instance.legacyRefs.some((ref) => matchesLegacy(ref, { worldId, propName })))
    .map((instance) => instance.id);
