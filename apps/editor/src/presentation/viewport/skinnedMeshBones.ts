import { z } from "zod";

export type SkinnedMeshBoneSource = {
  readonly name: string;
};

/** One `SkinnedMesh.skeleton`. Identity is the share key across meshes. */
export type SkinnedMeshSkeletonSource = {
  readonly bones: readonly SkinnedMeshBoneSource[];
};

/**
 * Enough of a loaded glTF node to read skins.
 * `isSkinnedMesh` matches Three.js `SkinnedMesh`.
 */
export type SkinnedMeshNodeSource = {
  readonly name?: string;
  readonly isSkinnedMesh?: boolean;
  readonly skeleton?: SkinnedMeshSkeletonSource | null;
  readonly children?: readonly SkinnedMeshNodeSource[];
};

/**
 * Bone names from `SkinnedMesh.skeleton.bones`, in tree order.
 * A skeleton object shared by several meshes is read once.
 * The same name twice inside one skeleton stays twice, in bone order.
 * A model with no skinned mesh returns an empty list.
 * No I/O. Does not mutate `root`.
 */
export const collectSkinnedMeshBoneNames = (root: SkinnedMeshNodeSource): { name: string }[] => {
  const bones: { name: string }[] = [];
  const seen = new Set<SkinnedMeshSkeletonSource>();
  const visit = (node: SkinnedMeshNodeSource): void => {
    const skeleton = node.isSkinnedMesh ? node.skeleton : undefined;
    if (skeleton && !seen.has(skeleton)) {
      seen.add(skeleton);
      for (const bone of skeleton.bones) bones.push({ name: bone.name });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return bones;
};

/**
 * Armature name for the import key.
 * The file root wins. Otherwise the first skinned mesh name.
 * Does not allocate an actor id.
 */
export const gltfRigNodeName = (root: SkinnedMeshNodeSource): string => {
  const rootName = root.name?.normalize("NFKC").trim();
  if (rootName) return rootName;
  let meshName = "";
  const visit = (node: SkinnedMeshNodeSource): void => {
    if (meshName) return;
    const name = node.isSkinnedMesh ? node.name?.normalize("NFKC").trim() : undefined;
    if (name) {
      meshName = name;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return meshName || "SkinnedMesh";
};

const unmappedBoneSchema = z.object({
  kind: z.literal("bone"),
  bone: z.string(),
  reason: z.literal("unmapped"),
});

const MAX_LISTED_BONES = 8;

/**
 * Viewport copy for bones `importRiggedActor` could not map.
 * Unmapped bones are warnings. Missing parts and ambiguous bones are not load errors
 * and are not turned into this copy.
 */
export const unmappedBoneWarnings = (diagnostics: unknown): string[] => {
  if (!Array.isArray(diagnostics)) return [];
  const names: string[] = [];
  for (const item of diagnostics) {
    const parsed = unmappedBoneSchema.safeParse(item);
    if (!parsed.success) continue;
    const bone = parsed.data.bone.trim();
    if (bone) names.push(bone);
  }
  if (names.length === 0) return [];
  const shown = names.slice(0, MAX_LISTED_BONES);
  const extra = names.length - shown.length;
  const tail = extra > 0 ? ` 외 ${extra}개` : "";
  return [`경고: 매핑되지 않은 본 ${shown.join(", ")}${tail}`];
};

/**
 * Warnings for rig imports whose actor is still in the scene.
 * Newest import for an actor wins. A restored (undone) actor drops out.
 */
export const rigWarningsForActors = (
  events: readonly { type: string; payload: Record<string, unknown> }[],
  worldId: string,
  liveActorIds: ReadonlySet<string>,
): string[] => {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const item = events[index];
    if (!item || item.type !== "RiggedActorImported" || item.payload.worldId !== worldId) continue;
    const actorId = item.payload.actorId;
    if (typeof actorId !== "string" || seen.has(actorId)) continue;
    seen.add(actorId);
    if (!liveActorIds.has(actorId)) continue;
    warnings.push(...unmappedBoneWarnings(item.payload.diagnostics));
  }
  return warnings;
};
