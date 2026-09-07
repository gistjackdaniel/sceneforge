import type { WorldAsset, WorldElement } from "./types";
import { normalizeWorldAsset } from "./normalize";

const COLOR_BLOCK_ELEMENTS: WorldElement[] = [
  {
    id: "elem-room-living",
    name: "Living Room Zone",
    kind: "room",
    description: "메인 대화 장면 구역",
  },
  {
    id: "elem-actor-mark-a",
    name: "Actor Mark A",
    kind: "actor_mark",
    description: "주연 배우 기본 스탠딩 위치",
  },
  {
    id: "elem-camera-anchor-wide",
    name: "Camera Anchor Wide",
    kind: "camera_anchor",
    description: "와이드 샷 기본 카메라 앵커",
  },
  {
    id: "elem-light-socket-window",
    name: "Window Light Socket",
    kind: "light_socket",
    description: "창문 역광 라이트 소켓",
  },
  {
    id: "elem-material-window",
    name: "Window Glass Material",
    kind: "material_slot",
    description: "유리 색상 오버라이드 슬롯",
  },
];

export const createMeshExampleWorld = (): WorldAsset =>
  normalizeWorldAsset({
    id: "world-apartment-livingroom",
    name: "Apartment Livingroom",
    description: "색이 다른 벽·큐브·구·콘으로 mesh 미리보기를 구분할 수 있는 예제 로케이션.",
    usdPath: "worlds/apartment_livingroom/world.usda",
    semanticsPath: "worlds/apartment_livingroom/semantics.json",
    navmeshPath: "worlds/apartment_livingroom/navmesh.bin",
    previewPath: "worlds/apartment_livingroom/preview.glb",
    surfaceMeshPath: "worlds/apartment_livingroom/preview.glb",
    proxyKind: "usd",
    representation: "mesh",
    rootUri: "worlds/apartment_livingroom",
    previewUri: "worlds/apartment_livingroom/preview.glb",
    semanticTags: ["interior", "apartment", "livingroom", "mesh"],
    props: ["cube", "sphere", "cone"],
    elements: COLOR_BLOCK_ELEMENTS,
  });

export const createSplatExampleWorld = (): WorldAsset =>
  normalizeWorldAsset({
    id: "world-color-block-splat",
    name: "Color Block Splats",
    description: "같은 세트의 gaussian splat 미리보기. 부드러운 원반으로 mesh/points와 구분된다.",
    previewPath: "worlds/color_block_room/splats.ply",
    visualLayer3dgsPath: "worlds/color_block_room/splats.ply",
    proxyKind: "3dgs",
    representation: "gaussian_splat",
    rootUri: "worlds/color_block_room",
    previewUri: "worlds/color_block_room/splats.ply",
    semanticTags: ["interior", "gaussian_splat"],
    props: ["cube", "sphere", "cone"],
    elements: COLOR_BLOCK_ELEMENTS,
  });

export const createPointCloudExampleWorld = (): WorldAsset =>
  normalizeWorldAsset({
    id: "world-color-block-points",
    name: "Color Block Points",
    description: "같은 세트의 point cloud 미리보기. 이산 점으로 mesh/splat과 구분된다.",
    previewPath: "worlds/color_block_room/points.ply",
    proxyKind: "usd",
    representation: "point_cloud",
    rootUri: "worlds/color_block_room",
    previewUri: "worlds/color_block_room/points.ply",
    semanticTags: ["interior", "point_cloud"],
    props: ["cube", "sphere", "cone"],
    elements: COLOR_BLOCK_ELEMENTS,
  });

export const sampleViewportWorlds = (): WorldAsset[] => [
  createMeshExampleWorld(),
  createSplatExampleWorld(),
  createPointCloudExampleWorld(),
];
