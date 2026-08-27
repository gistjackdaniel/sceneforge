import type { CacheKind } from "./types";

/** Change categories from PRD §11.5. */
export type CacheChangeKind =
  | "node_ui_position"
  | "node_display_name"
  | "camera_transform"
  | "lens_parameter"
  | "object_transform"
  | "material_content"
  | "asset_tag"
  | "asset_content"
  | "clip_start"
  | "clip_duration"
  | "render_quality";

export const CHANGE_INVALIDATION_TABLE: Record<CacheChangeKind, CacheKind[]> = {
  node_ui_position: [],
  node_display_name: [],
  asset_tag: [],
  camera_transform: ["node_evaluation", "proxy", "final", "stage_render_pass"],
  lens_parameter: ["node_evaluation", "proxy", "final", "stage_render_pass"],
  object_transform: ["node_evaluation", "proxy", "final", "stage_render_pass"],
  material_content: ["node_evaluation", "proxy", "final"],
  asset_content: ["node_evaluation", "proxy", "final", "world_reconstruction"],
  clip_start: [],
  clip_duration: ["proxy", "final"],
  render_quality: ["proxy", "final"],
};

export const layersInvalidatedByChange = (kind: CacheChangeKind): CacheKind[] =>
  CHANGE_INVALIDATION_TABLE[kind] ?? ["proxy", "final"];

export const shouldPreserveCacheOnChange = (kind: CacheChangeKind): boolean =>
  layersInvalidatedByChange(kind).length === 0;
