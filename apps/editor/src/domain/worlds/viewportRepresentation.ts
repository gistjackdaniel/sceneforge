import type { AssetRecord } from "../assets/types";
import type { WorldAsset, WorldElement, WorldRepresentation } from "./types";

export type ViewportLoaderKind = "mesh" | "image_proxy" | "gaussian_splat" | "point_cloud" | "unsupported";

export type ViewportLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "missing_artifact"
  | "malformed"
  | "unsupported";

export interface ViewportRepresentationPlan {
  kind: ViewportLoaderKind;
  uri?: string;
  representation: WorldRepresentation | "none";
  reason?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MESH_EXT = /\.(glb|gltf)$/i;
const SPLAT_EXT = /\.(splat|spz|ksplat)$/i;
const POINT_EXT = /\.(ply|pcd)$/i;

export const isViewportImageUri = (uri: string): boolean =>
  IMAGE_EXT.test(uri) || uri.startsWith("data:image/");

const isMeshUri = (uri: string): boolean => MESH_EXT.test(uri);

const isSplatUri = (uri: string): boolean => SPLAT_EXT.test(uri) || POINT_EXT.test(uri);

const isPointCloudUri = (uri: string): boolean => POINT_EXT.test(uri);

const firstUri = (
  candidates: Array<string | undefined>,
  predicate: (uri: string) => boolean,
): string | undefined =>
  candidates.find((uri): uri is string => typeof uri === "string" && uri.length > 0 && predicate(uri));

const pushUniqueImage = (uris: string[], uri: string | undefined): void => {
  if (!uri || !isViewportImageUri(uri) || uris.includes(uri)) {
    return;
  }
  uris.push(uri);
};

/**
 * Image URIs that can stand in when mesh load fails (source photo, preview still).
 * Does not include mesh paths.
 */
export const viewportImageUris = (
  world: WorldAsset | undefined,
  assets?: Record<string, AssetRecord>,
): string[] => {
  if (!world) {
    return [];
  }
  const uris: string[] = [];
  pushUniqueImage(uris, world.previewUri);
  pushUniqueImage(uris, world.previewPath);
  const assetIds = [
    ...world.sourceAssetIds,
    ...(world.generatedBy?.inputAssetIds ?? []),
  ];
  for (const id of assetIds) {
    const asset = assets?.[id];
    if (!asset || asset.type === "mesh" || asset.type === "world") {
      continue;
    }
    pushUniqueImage(uris, asset.thumbnailUri);
    pushUniqueImage(uris, asset.uri);
  }
  return uris;
};

export const firstViewportImageUri = (
  world: WorldAsset | undefined,
  assets?: Record<string, AssetRecord>,
): string | undefined => viewportImageUris(world, assets)[0];

/**
 * Pick a viewport loader from WorldAsset capabilities.
 * Mesh stays first when a glb exists. Otherwise gaussian splat, then point cloud, then image proxy.
 */
export const resolveViewportRepresentation = (
  world: WorldAsset | undefined,
): ViewportRepresentationPlan => {
  if (!world) {
    return { kind: "unsupported", representation: "none", reason: "표시할 월드가 없습니다." };
  }
  if (!world.id || !world.rootUri) {
    return {
      kind: "unsupported",
      representation: world.representation,
      reason: "월드 매니페스트가 올바르지 않습니다.",
    };
  }

  const meshCandidate = firstUri(
    [world.surfaceMeshPath, world.previewPath, world.previewUri, world.rootUri],
    isMeshUri,
  );
  const splatCandidate = firstUri(
    [world.visualLayer3dgsPath, world.previewPath, world.previewUri, world.rootUri],
    isSplatUri,
  );
  const pointCandidate = firstUri(
    [world.previewPath, world.previewUri, world.rootUri],
    isPointCloudUri,
  );
  const imageCandidate = firstUri(
    [world.previewUri, world.previewPath, world.rootUri],
    isViewportImageUri,
  );

  if (meshCandidate) {
    return { kind: "mesh", uri: meshCandidate, representation: world.representation };
  }
  if (world.representation === "gaussian_splat" || world.visualLayer3dgsPath) {
    if (splatCandidate) {
      return { kind: "gaussian_splat", uri: splatCandidate, representation: world.representation };
    }
    return {
      kind: "unsupported",
      representation: world.representation,
      reason: "Gaussian splat artifact가 없습니다.",
    };
  }
  if (world.representation === "point_cloud" || pointCandidate) {
    if (pointCandidate) {
      return { kind: "point_cloud", uri: pointCandidate, representation: world.representation };
    }
    return {
      kind: "unsupported",
      representation: world.representation,
      reason: "Point cloud artifact가 없습니다.",
    };
  }
  if (imageCandidate) {
    return { kind: "image_proxy", uri: imageCandidate, representation: world.representation };
  }
  if (!world.surfaceMeshPath && !world.previewPath && !world.previewUri && !world.visualLayer3dgsPath) {
    return {
      kind: "unsupported",
      representation: world.representation,
      reason: "미리보기 artifact가 없습니다.",
    };
  }
  return {
    kind: "unsupported",
    representation: world.representation,
    reason: "이 표현은 Viewport에서 렌더할 수 없습니다.",
  };
};

export type OverlayKind = "actorMarks" | "cameraAnchors" | "lightSockets" | "propSockets" | "walkableZones";

const OVERLAY_ELEMENT_KIND: Record<OverlayKind, WorldElement["kind"]> = {
  actorMarks: "actor_mark",
  cameraAnchors: "camera_anchor",
  lightSockets: "light_socket",
  propSockets: "socket",
  walkableZones: "zone",
};

export const OVERLAY_LABELS: Record<OverlayKind, string> = {
  actorMarks: "Actor marks",
  cameraAnchors: "Camera anchors",
  lightSockets: "Light sockets",
  propSockets: "Prop sockets",
  walkableZones: "Walkable zones",
};

export const worldOverlayAvailability = (
  world: WorldAsset | undefined,
): Record<OverlayKind, { available: boolean; reason?: string }> => {
  const counts = (kind: WorldElement["kind"]) =>
    world?.elements.filter((element) => element.kind === kind).length ?? 0;
  return {
    actorMarks: {
      available: counts("actor_mark") > 0,
      reason: counts("actor_mark") > 0 ? undefined : "이 월드에 actor mark가 없습니다.",
    },
    cameraAnchors: {
      available: counts("camera_anchor") > 0,
      reason: counts("camera_anchor") > 0 ? undefined : "이 월드에 camera anchor가 없습니다.",
    },
    lightSockets: {
      available: counts("light_socket") > 0,
      reason: counts("light_socket") > 0 ? undefined : "이 월드에 light socket이 없습니다.",
    },
    propSockets: {
      available: counts("socket") > 0,
      reason: counts("socket") > 0 ? undefined : "이 월드에 prop socket이 없습니다.",
    },
    walkableZones: {
      available: counts("zone") > 0,
      reason: counts("zone") > 0 ? undefined : "이 월드에 walkable zone이 없습니다.",
    },
  };
};

export const overlayElementKind = (overlay: OverlayKind): WorldElement["kind"] =>
  OVERLAY_ELEMENT_KIND[overlay];

export const overlayKindForElement = (kind: WorldElement["kind"]): OverlayKind | undefined => {
  const match = (Object.entries(OVERLAY_ELEMENT_KIND) as Array<[OverlayKind, WorldElement["kind"]]>).find(
    ([, elementKind]) => elementKind === kind,
  );
  return match?.[0];
};

/** Elements that Viewport may draw as overlay markers. Room / material_slot are never markers. */
export const worldOverlayMarkerElements = (world: WorldAsset | undefined): WorldElement[] =>
  world?.elements.filter((element) => overlayKindForElement(element.kind) !== undefined) ?? [];

export const viewportPreviewBadge = (
  plan: ViewportRepresentationPlan,
  showingImageProxy = false,
): string => {
  if (showingImageProxy || plan.kind === "image_proxy") {
    return "image proxy";
  }
  if (plan.kind === "mesh") {
    return "mesh";
  }
  if (plan.kind === "gaussian_splat") {
    return "gaussian splat";
  }
  if (plan.kind === "point_cloud") {
    return "point cloud";
  }
  return plan.reason ?? "no preview";
};
