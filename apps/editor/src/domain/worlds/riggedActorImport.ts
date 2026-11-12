import { linkPosedSubject } from "../shot/instanceLink";
import { subjectId, type AssetId } from "../shot/types";
import {
  DEFAULT_HANDEDNESS,
  applyImportTransform,
  buildImportTransform,
  defaultFrontAxis,
  type Mat4,
} from "./coordinates";
import { WorldDomainError } from "./errors";
import { ID_PREFIX, reserveSceneIds, type PersistentIdFactory } from "./ids";
import {
  SMPLX_PART_JOINT,
  rigPartSchema,
  scenePersistentIds,
  sceneStateSchema,
  type ActorInstance,
  type LegacyRef,
  type RigPart,
  type SceneState,
} from "./sceneState";

const NEUTRAL_BETAS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

/**
 * Joint names a GLB or FBX importer already read.
 * `StageViewport` loads GLB for display and does not read joints.
 * FBX has no loader in this repo. Callers pass the parsed node here.
 */
export type ImportedSkeletonNode = {
  name: string;
  /** Joint. Set for GLTF skin joints and FBX bone clusters. */
  isBone?: boolean;
  children?: readonly ImportedSkeletonNode[];
};

export type RiggedActorSourceAxes = {
  coordinateSystem?: "Y_UP" | "Z_UP";
  /** Wins over `coordinateSystem` when both are set. */
  upAxis?: "Y" | "Z";
  handedness?: "right" | "left";
  frontAxis?: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
  /** World-asset field. Used when `metersPerUnit` is omitted. */
  unitScaleMeters?: number;
  /** Wins over `unitScaleMeters` when both are set. */
  metersPerUnit?: number;
};

export type RiggedActorImportSource = {
  assetId: string;
  revisionId: string;
  /** GLB, FBX, or other source path. Query and hash are not part of the key. */
  sourcePath: string;
  /** Armature or root node name inside the file. */
  nodeName: string;
  bones: readonly { name: string }[];
  label: string;
  /** Rest translation in source units, before the coordinate contract. */
  restTranslation?: readonly [number, number, number];
  /** Unit quaternion in the source frame, `[x, y, z, w]`. */
  restRotation?: readonly [number, number, number, number];
  restScale?: readonly [number, number, number];
  sourceAxes?: RiggedActorSourceAxes;
  /**
   * Earlier id such as `subject-*` or `actor-a`.
   * Stored on `legacyRefs` through `linkPosedSubject`. Not used as the instance id.
   */
  legacySubjectId?: string;
  /** Shot that owned `legacySubjectId`. Defaults to the scene world id. */
  shotId?: string;
  /** Earlier asset id such as `file:<hash>`. Stored as `shot_asset`. */
  legacyAssetId?: string;
  gender?: "neutral" | "male" | "female";
  betas?: readonly number[];
};

export type RigPartDiagnostic =
  | { kind: "bone"; bone: string; reason: "unmapped" | "ambiguous"; candidates?: readonly RigPart[] }
  | { kind: "part"; part: RigPart; reason: "missing" };

export type RiggedActorImportResult = {
  scene: SceneState;
  actor: ActorInstance;
  sourceKey: string;
  /** False when this source key already had an actor, including a tombstone. */
  minted: boolean;
  /** Rig part to joint name. Missing parts are listed in `diagnostics`. */
  partMap: Record<string, string>;
  diagnostics: RigPartDiagnostic[];
  /** Absent when the source is already the canonical scene. */
  importTransform?: Mat4;
};

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const BONE_ALIASES: Record<RigPart, readonly string[]> = {
  left_hand: ["left_hand", "left_wrist", "lefthand", "leftwrist", "l_hand", "l_wrist", "hand_l", "wrist_l", "왼손"],
  right_hand: ["right_hand", "right_wrist", "righthand", "rightwrist", "r_hand", "r_wrist", "hand_r", "wrist_r", "오른손"],
  left_foot: ["left_foot", "left_ankle", "leftfoot", "leftankle", "l_foot", "l_ankle", "foot_l", "ankle_l", "왼발"],
  right_foot: ["right_foot", "right_ankle", "rightfoot", "rightankle", "r_foot", "r_ankle", "foot_r", "ankle_r", "오른발"],
  head: ["head", "머리"],
  pelvis: ["pelvis", "hips", "hip", "골반"],
};

const SIDELESS: Record<string, readonly RigPart[]> = {
  hand: ["left_hand", "right_hand"],
  wrist: ["left_hand", "right_hand"],
  foot: ["left_foot", "right_foot"],
  ankle: ["left_foot", "right_foot"],
};

const normalizeBoneName = (name: string): string => {
  const lowered = name.normalize("NFKC").trim().toLowerCase();
  const underscored = lowered.replace(/[:.\-\s]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return underscored.replace(/^(mixamorig|bip001|bip01)_/, "");
};

const aliasToPart = (): Map<string, RigPart> => {
  const table = new Map<string, RigPart>();
  for (const part of rigPartSchema.options) {
    const names = [part, SMPLX_PART_JOINT[part], ...BONE_ALIASES[part]];
    for (const name of names) {
      const key = normalizeBoneName(name);
      if (!key || table.has(key)) continue;
      table.set(key, part);
    }
  }
  return table;
};

const ALIAS_TO_PART = aliasToPart();

const normalizeSourcePath = (value: string): string => {
  const trimmed = value.trim();
  const withoutQuery = trimmed.split("?")[0] ?? trimmed;
  const withoutHash = withoutQuery.split("#")[0] ?? withoutQuery;
  let path = withoutHash.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
};

/**
 * Identity of one imported node.
 * Same asset revision, source path, and node name keep one actor id.
 * A new revision is a different source. `pinInstanceRevision` moves a pin without a new id.
 */
export const riggedActorSourceKey = (source: {
  revisionId: string;
  sourcePath: string;
  nodeName: string;
}): string => {
  const revisionId = source.revisionId.trim();
  const sourcePath = normalizeSourcePath(source.sourcePath);
  const nodeName = source.nodeName.normalize("NFKC").trim();
  if (!revisionId || !sourcePath || !nodeName) {
    throw new WorldDomainError("invalid_source", "Rigged actor source needs a revision, path, and node name.");
  }
  return `${revisionId}\u001f${sourcePath}\u001f${nodeName}`;
};

const positiveMeters = (value: number | undefined): number | undefined =>
  value !== undefined && value > 0 && Number.isFinite(value) ? value : undefined;

const resolvedAxes = (axes: RiggedActorSourceAxes | undefined) => {
  const upAxis = axes?.upAxis ?? (axes?.coordinateSystem === "Z_UP" ? "Z" : "Y");
  const coordinateSystem = upAxis === "Z" ? "Z_UP" : "Y_UP";
  const handedness = axes?.handedness ?? DEFAULT_HANDEDNESS;
  const frontAxis = axes?.frontAxis ?? defaultFrontAxis(coordinateSystem);
  const metersPerUnit = positiveMeters(axes?.metersPerUnit) ?? positiveMeters(axes?.unitScaleMeters) ?? 1;
  return { upAxis, handedness, frontAxis, metersPerUnit };
};

/**
 * Map a rig file into `SCENE_COORDINATE_CONTRACT` (right-handed, +Y up, meters, front +Z).
 * Explicit unit, up axis, handedness, and front axis win. Missing fields use the same
 * defaults as `environmentImportTransform`: right-handed, `+Z`, or `-Y` when Z-up.
 * Returns undefined when the source is already canonical. Does not read `Shot.time.fps`.
 */
export const riggedActorImportTransform = (axes?: RiggedActorSourceAxes): Mat4 | undefined => {
  const resolved = resolvedAxes(axes);
  if (
    resolved.upAxis === "Y" &&
    resolved.metersPerUnit === 1 &&
    resolved.handedness === "right" &&
    resolved.frontAxis === "+Z"
  ) {
    return undefined;
  }
  return buildImportTransform(resolved);
};

/** Inverse of a row-major import matrix. Used to prove the coordinate conversion round-trips. */
export const invertImportTransform = (matrix: Mat4): Mat4 => {
  const rows = matrix.map((row) => [...row]);
  const inverse = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let col = 0; col < 4; col += 1) {
    let pivot = col;
    let pivotAbs = Math.abs(rows[col]?.[col] ?? 0);
    for (let row = col + 1; row < 4; row += 1) {
      const value = Math.abs(rows[row]?.[col] ?? 0);
      if (value > pivotAbs) {
        pivot = row;
        pivotAbs = value;
      }
    }
    if (!(pivotAbs > 1e-12)) {
      throw new WorldDomainError("invalid_transform", "Import transform is not invertible.");
    }
    if (pivot !== col) {
      const rowSwap = rows[col];
      rows[col] = rows[pivot] ?? [];
      rows[pivot] = rowSwap ?? [];
      const inverseSwap = inverse[col];
      inverse[col] = inverse[pivot] ?? [];
      inverse[pivot] = inverseSwap ?? [];
    }
    const scale = rows[col]?.[col] ?? 1;
    for (let index = 0; index < 4; index += 1) {
      const current = rows[col];
      const inverted = inverse[col];
      if (!current || !inverted) continue;
      current[index] = (current[index] ?? 0) / scale;
      inverted[index] = (inverted[index] ?? 0) / scale;
    }
    for (let row = 0; row < 4; row += 1) {
      if (row === col) continue;
      const factor = rows[row]?.[col] ?? 0;
      for (let index = 0; index < 4; index += 1) {
        const current = rows[row];
        const inverted = inverse[row];
        const pivotRow = rows[col];
        const pivotInverse = inverse[col];
        if (!current || !inverted || !pivotRow || !pivotInverse) continue;
        current[index] = (current[index] ?? 0) - factor * (pivotRow[index] ?? 0);
        inverted[index] = (inverted[index] ?? 0) - factor * (pivotInverse[index] ?? 0);
      }
    }
  }
  const tuple = (values: number[] | undefined): [number, number, number, number] => {
    if (!values || values.length < 4 || !values.every((value) => Number.isFinite(value))) {
      throw new WorldDomainError("invalid_transform", "Import transform inverse is incomplete.");
    }
    return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
  };
  return [tuple(inverse[0]), tuple(inverse[1]), tuple(inverse[2]), tuple(inverse[3])];
};

const normalizeQuat = (quat: readonly [number, number, number, number]): Quat => {
  const length = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new WorldDomainError("invalid_transform", "Source rotation must be a quaternion.");
  }
  return [quat[0] / length, quat[1] / length, quat[2] / length, quat[3] / length];
};

const quatToMat3 = (quat: Quat): number[][] => {
  const [x, y, z, w] = quat;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    [1 - (yy + zz), xy - wz, xz + wy],
    [xy + wz, 1 - (xx + zz), yz - wx],
    [xz - wy, yz + wx, 1 - (xx + yy)],
  ];
};

const mat3ToQuat = (matrix: number[][]): Quat => {
  const m00 = matrix[0]?.[0] ?? 0;
  const m01 = matrix[0]?.[1] ?? 0;
  const m02 = matrix[0]?.[2] ?? 0;
  const m10 = matrix[1]?.[0] ?? 0;
  const m11 = matrix[1]?.[1] ?? 0;
  const m12 = matrix[1]?.[2] ?? 0;
  const m20 = matrix[2]?.[0] ?? 0;
  const m21 = matrix[2]?.[1] ?? 0;
  const m22 = matrix[2]?.[2] ?? 0;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = 0.25 * scale;
    x = (m21 - m12) / scale;
    y = (m02 - m20) / scale;
    z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / scale;
    x = 0.25 * scale;
    y = (m01 + m10) / scale;
    z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / scale;
    x = (m01 + m10) / scale;
    y = 0.25 * scale;
    z = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / scale;
    x = (m02 + m20) / scale;
    y = (m12 + m21) / scale;
    z = 0.25 * scale;
  }
  return normalizeQuat([x, y, z, w]);
};

const multiplyMat3 = (left: number[][], right: number[][]): number[][] => {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row]![col] =
        (left[row]?.[0] ?? 0) * (right[0]?.[col] ?? 0) +
        (left[row]?.[1] ?? 0) * (right[1]?.[col] ?? 0) +
        (left[row]?.[2] ?? 0) * (right[2]?.[col] ?? 0);
    }
  }
  return out;
};

const transposeMat3 = (matrix: number[][]): number[][] => [
  [matrix[0]?.[0] ?? 0, matrix[1]?.[0] ?? 0, matrix[2]?.[0] ?? 0],
  [matrix[0]?.[1] ?? 0, matrix[1]?.[1] ?? 0, matrix[2]?.[1] ?? 0],
  [matrix[0]?.[2] ?? 0, matrix[1]?.[2] ?? 0, matrix[2]?.[2] ?? 0],
];

const linearBasis = (matrix: Mat4): number[][] => {
  const scale = Math.hypot(matrix[0][0], matrix[1][0], matrix[2][0]);
  if (!(scale > 0)) throw new WorldDomainError("invalid_transform", "Import transform has a zero axis.");
  return [
    [matrix[0][0] / scale, matrix[0][1] / scale, matrix[0][2] / scale],
    [matrix[1][0] / scale, matrix[1][1] / scale, matrix[1][2] / scale],
    [matrix[2][0] / scale, matrix[2][1] / scale, matrix[2][2] / scale],
  ];
};

/**
 * Change a source-frame quaternion into the canonical scene.
 * Scale drops out. A left-handed source is conjugated by the mirrored basis.
 * `matrix` undefined means the source frame is already canonical.
 */
export const convertSourceRotation = (
  matrix: Mat4 | undefined,
  rotation: readonly [number, number, number, number],
): Quat => {
  const source = normalizeQuat(rotation);
  if (!matrix) return source;
  const basis = linearBasis(matrix);
  const changed = multiplyMat3(multiplyMat3(basis, quatToMat3(source)), transposeMat3(basis));
  return mat3ToQuat(changed);
};

const canonicalPoint = (matrix: Mat4 | undefined, point: readonly [number, number, number]): Vec3 => {
  const [x, y, z] = point;
  if (![x, y, z].every((value) => Number.isFinite(value))) {
    throw new WorldDomainError("invalid_transform", "Source translation must be finite.");
  }
  return matrix ? applyImportTransform(matrix, [x, y, z]) : [x, y, z];
};

/** Walk a parsed GLB/FBX hierarchy and keep joint nodes in file order. */
export const collectImportedBones = (root: ImportedSkeletonNode): { name: string }[] => {
  const bones: { name: string }[] = [];
  const walk = (node: ImportedSkeletonNode): void => {
    if (node.isBone && node.name.trim()) bones.push({ name: node.name });
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return bones;
};

type BoneEntry = { name: string; index: number };

const findBone = (entries: readonly BoneEntry[], used: Set<number>, names: readonly string[] | undefined): BoneEntry | undefined => {
  if (!names) return undefined;
  for (const name of names) {
    const found = entries.find((entry) => entry.name === name && !used.has(entry.index));
    if (found) return found;
  }
  return undefined;
};

/**
 * Map imported joints onto `rigPartSchema`.
 * `partMap` is the asset revision override (rig part to joint). It wins when that joint is in the file.
 * SMPL-X names (`left_wrist`) and common Mixamo / Biped names map without an override.
 * A joint that matches nothing, or more than one part, is a diagnostic. This does not throw.
 * No I/O. Does not write the scene. Dependency hashes do not include this list.
 */
export const mapImportedRigParts = (
  bones: readonly { name: string }[],
  partMap?: Record<string, string>,
): { partMap: Record<string, string>; diagnostics: RigPartDiagnostic[] } => {
  const entries: BoneEntry[] = [];
  bones.forEach((bone, index) => {
    if (bone.name.trim()) entries.push({ name: bone.name, index });
  });
  const byExact = new Map<string, string[]>();
  const byNormal = new Map<string, string[]>();
  for (const entry of entries) {
    const exact = byExact.get(entry.name) ?? [];
    exact.push(entry.name);
    byExact.set(entry.name, exact);
    const normal = normalizeBoneName(entry.name);
    const folded = byNormal.get(normal) ?? [];
    folded.push(entry.name);
    byNormal.set(normal, folded);
  }
  const used = new Set<number>();
  const assigned = new Map<RigPart, string>();
  for (const part of rigPartSchema.options) {
    const joint = partMap?.[part];
    if (!joint) continue;
    const found =
      findBone(entries, used, byExact.get(joint)) ??
      findBone(entries, used, byNormal.get(normalizeBoneName(joint)));
    if (!found) continue;
    assigned.set(part, found.name);
    used.add(found.index);
  }
  const diagnostics: RigPartDiagnostic[] = [];
  for (const entry of entries) {
    if (used.has(entry.index)) continue;
    const normalized = normalizeBoneName(entry.name);
    const sideless = SIDELESS[normalized];
    if (sideless) {
      diagnostics.push({ kind: "bone", bone: entry.name, reason: "ambiguous", candidates: sideless });
      used.add(entry.index);
      continue;
    }
    const part = normalized ? ALIAS_TO_PART.get(normalized) : undefined;
    if (!part) {
      diagnostics.push({ kind: "bone", bone: entry.name, reason: "unmapped" });
      continue;
    }
    if (assigned.has(part)) {
      diagnostics.push({ kind: "bone", bone: entry.name, reason: "ambiguous", candidates: [part] });
      continue;
    }
    assigned.set(part, entry.name);
    used.add(entry.index);
  }
  const mapped: Record<string, string> = {};
  for (const part of rigPartSchema.options) {
    const bone = assigned.get(part);
    if (bone) mapped[part] = bone;
    else diagnostics.push({ kind: "part", part, reason: "missing" });
  }
  diagnostics.sort((left, right) => {
    const leftKey = left.kind === "bone" ? `0:${left.bone}` : `1:${left.part}`;
    const rightKey = right.kind === "bone" ? `0:${right.bone}` : `1:${right.part}`;
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  return { partMap: mapped, diagnostics };
};

const refKey = (ref: LegacyRef): string => JSON.stringify(ref);

const mergeLegacy = (current: readonly LegacyRef[], extra: readonly LegacyRef[]): LegacyRef[] => {
  const next = [...current];
  const seen = new Set(next.map(refKey));
  for (const ref of extra) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(ref);
  }
  return next;
};

const finiteTriple = (values: readonly [number, number, number] | undefined, fallback: Vec3, code: string): Vec3 => {
  if (!values) return fallback;
  if (!values.every((value) => Number.isFinite(value))) {
    throw new WorldDomainError(code, "Source scale or translation is not finite.");
  }
  return [values[0], values[1], values[2]];
};

const legacyRefsFor = (
  scene: SceneState,
  source: RiggedActorImportSource,
  instanceId: string,
  translation: Vec3,
  scale: Vec3,
  label: string,
): LegacyRef[] => {
  const subject = source.legacySubjectId?.trim();
  const legacyAssetId = source.legacyAssetId?.trim();
  if (!subject) {
    return legacyAssetId ? [{ kind: "shot_asset", assetId: legacyAssetId }] : [];
  }
  const asset = legacyAssetId || source.sourcePath;
  const linked = linkPosedSubject(source.shotId?.trim() || scene.worldId, {
    id: subjectId(subject),
    assetId: asset as AssetId,
    assetVersion: 1,
    name: label,
    uri: source.sourcePath,
    placement: { position: translation, rotationEuler: [0, 0, 0], scale },
    visible: true,
    locked: false,
    kind: "human",
    representation: "mesh",
    motion: { channel: "unset" },
    instanceId,
    assetRef: { assetId: source.assetId, revisionId: source.revisionId },
  });
  return linked.legacyRefs ?? [];
};

const writeActor = (scene: SceneState, actor: ActorInstance): SceneState => {
  const parsed = sceneStateSchema.safeParse({
    ...scene,
    actors: { ...scene.actors, [actor.id]: actor },
  });
  if (!parsed.success) {
    throw new WorldDomainError("invalid_scene", "Rigged actor import does not satisfy the world contract.");
  }
  return parsed.data;
};

/**
 * Create an `ActorInstance` for one rigged actor, or return the actor already imported from that source.
 * The first import mints `act_<ULID>` once. The same revision, path, and node keep that id,
 * including when the actor is tombstoned. A different path, node, or revision mints another id.
 * Rest translation and rotation are converted into the canonical scene on the first import.
 * Later imports do not move the rest pose or the label.
 * `subject-*` and other earlier ids are copied onto `legacyRefs` and are not the instance id.
 * Part mapping failures stay in `diagnostics`.
 * No I/O. Does not mutate `scene`. Adds one actor, so `instance_identity` changes only on the first import.
 */
export const importRiggedActor = (
  scene: SceneState,
  source: RiggedActorImportSource,
  ids: PersistentIdFactory,
): RiggedActorImportResult => {
  const revision = scene.revisions[source.revisionId];
  if (!revision || revision.assetId !== source.assetId) {
    throw new WorldDomainError("missing_revision", "Rigged actor asset revision was not found.");
  }
  const sourceKey = riggedActorSourceKey(source);
  const nodeName = source.nodeName.normalize("NFKC").trim();
  const label = source.label.trim() || nodeName;
  if (!label) throw new WorldDomainError("invalid_label", "Actor label is empty.");
  const importTransform = riggedActorImportTransform(source.sourceAxes);
  const translation = canonicalPoint(importTransform, finiteTriple(source.restTranslation, [0, 0, 0], "invalid_transform"));
  const rotation = convertSourceRotation(importTransform, source.restRotation ?? [0, 0, 0, 1]);
  const scale = finiteTriple(source.restScale, [1, 1, 1], "invalid_transform");
  const mapped = mapImportedRigParts(source.bones, revision.rig?.partMap);
  const existing = Object.values(scene.actors).find((actor) => actor.importKey === sourceKey);
  if (existing) {
    const legacyRefs = mergeLegacy(existing.legacyRefs, legacyRefsFor(scene, source, existing.id, translation, scale, label));
    const sameRefs = JSON.stringify(existing.legacyRefs) === JSON.stringify(legacyRefs);
    const actor = sameRefs ? existing : { ...existing, legacyRefs };
    return {
      scene: sameRefs ? scene : writeActor(scene, actor),
      actor,
      sourceKey,
      minted: false,
      partMap: mapped.partMap,
      diagnostics: mapped.diagnostics,
      ...(importTransform ? { importTransform } : {}),
    };
  }
  const betas = source.betas ? [...source.betas] : [...NEUTRAL_BETAS];
  if (betas.length !== 10 || betas.some((value) => !Number.isFinite(value))) {
    throw new WorldDomainError("invalid_skeleton", "Actor betas must be ten finite numbers.");
  }
  reserveSceneIds(ids, scenePersistentIds(scene));
  const id = ids.mint(ID_PREFIX.actor);
  const actor: ActorInstance = {
    id,
    type: "actor",
    label,
    aliases: [],
    localizedNames: {},
    assetRef: { assetId: source.assetId, revisionId: source.revisionId },
    restTransform: { translation, rotation, scale },
    importKey: sourceKey,
    legacyRefs: legacyRefsFor(scene, source, id, translation, scale, label),
    skeleton: { model: "smplx", gender: source.gender ?? "neutral", betas },
  };
  return {
    scene: writeActor(scene, actor),
    actor,
    sourceKey,
    minted: true,
    partMap: mapped.partMap,
    diagnostics: mapped.diagnostics,
    ...(importTransform ? { importTransform } : {}),
  };
};
