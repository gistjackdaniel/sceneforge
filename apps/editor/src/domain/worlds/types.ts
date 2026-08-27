import type { ModelExecutionRecord } from "./modelExecution";

export type WorldMode =
  | "referenced"
  | "image_based"
  | "structured_3d"
  | "3dgs"
  | "4dgs";

export type WorldRepresentation =
  | "usd_stage"
  | "mesh"
  | "point_cloud"
  | "gaussian_splat"
  | "image_based_proxy"
  | "video_based_proxy"
  | "hybrid";

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface WorldElement {
  id: string;
  name: string;
  kind:
    | "room"
    | "zone"
    | "socket"
    | "actor_mark"
    | "camera_anchor"
    | "light_socket"
    | "material_slot";
  description: string;
}

/**
 * WorldAsset = WorldAssetManifest (PRD §2.3) plus Lyra layer paths (PRD §2.4).
 * Manifest fields are source of truth; Lyra paths are connector-specific extensions.
 */
export interface WorldAsset {
  id: string;
  name: string;
  description: string;

  representation: WorldRepresentation;
  sourceAssetIds: string[];
  rootUri: string;
  previewUri?: string;
  coordinateSystem: "Y_UP" | "Z_UP";
  unitScaleMeters: number;
  bounds?: BoundingBox;
  semanticTags: string[];
  generatedBy?: ModelExecutionRecord;
  version: number;
  createdAt: string;
  updatedAt: string;

  /** Legacy / stage preview paths (kept for Phase 3–6 compatibility). */
  usdPath: string;
  semanticsPath: string;
  navmeshPath: string;
  previewPath: string;
  proxyKind: "usd" | "3dgs" | "image" | "4dgs";
  elements: WorldElement[];
  props: string[];
  sourceImageNodeId?: string;
  worldGenerateNodeId?: string;
  generatedSegmentNodeId?: string;
  spatialMemoryNodeId?: string;
  visualLayer3dgsPath?: string;
  surfaceMeshPath?: string;
  collisionMeshPath?: string;
  generatedSegmentPath?: string;
  spatialMemoryPath?: string;
  memoryCoverage?: number;
  generatedAreaRatio?: number;
  versions?: Array<{
    version: number;
    jobId: string;
    registeredAt: string;
    artifacts: Record<string, unknown> | object;
  }>;
}
