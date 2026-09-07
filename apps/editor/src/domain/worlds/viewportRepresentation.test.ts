import { describe, expect, it } from "vitest";
import {
  overlayKindForElement,
  resolveViewportRepresentation,
  viewportImageUris,
  viewportPreviewBadge,
  worldOverlayAvailability,
  worldOverlayMarkerElements,
} from "./viewportRepresentation";
import { normalizeWorldAsset } from "./normalize";
import { createAssetRecord } from "../assets/registry";

describe("resolveViewportRepresentation empty states", () => {
  it("handles missing world", () => {
    expect(resolveViewportRepresentation(undefined).kind).toBe("unsupported");
  });

  it("prefers image proxy when only a preview image exists", () => {
    const world = normalizeWorldAsset({
      id: "img",
      name: "Image world",
      representation: "image_based_proxy",
      previewUri: "previews/hero.png",
      rootUri: "previews/hero.png",
    });
    expect(resolveViewportRepresentation(world)).toMatchObject({ kind: "image_proxy", uri: "previews/hero.png" });
  });

  it("prefers mesh over gaussian splat when a glb path exists", () => {
    const world = normalizeWorldAsset({
      id: "hybrid",
      name: "Hybrid",
      representation: "gaussian_splat",
      visualLayer3dgsPath: "a.ply",
      surfaceMeshPath: "a.glb",
      rootUri: "a.glb",
    });
    expect(resolveViewportRepresentation(world).kind).toBe("mesh");
  });

  it("plans gaussian splat for splat-only worlds", () => {
    const world = normalizeWorldAsset({
      id: "splat",
      name: "Splat only",
      representation: "gaussian_splat",
      visualLayer3dgsPath: "worlds/color_block_room/splats.ply",
      rootUri: "worlds/color_block_room",
    });
    const plan = resolveViewportRepresentation(world);
    expect(plan).toMatchObject({ kind: "gaussian_splat", uri: "worlds/color_block_room/splats.ply" });
    expect(viewportPreviewBadge(plan)).toBe("gaussian splat");
  });

  it("keeps source images as splat load-fail fallback without changing the plan", () => {
    const world = normalizeWorldAsset({
      id: "splat-src",
      name: "Splat only",
      representation: "gaussian_splat",
      visualLayer3dgsPath: "a.ply",
      rootUri: "worlds/splat",
      sourceAssetIds: ["asset-img"],
    });
    const assets = {
      "asset-img": createAssetRecord({
        id: "asset-img",
        type: "image",
        name: "hero.png",
        uri: "data:image/png;base64,aaa",
      }),
    };
    expect(resolveViewportRepresentation(world).kind).toBe("gaussian_splat");
    expect(viewportImageUris(world, assets)).toEqual(["data:image/png;base64,aaa"]);
  });

  it("plans point cloud when a ply artifact exists", () => {
    const world = normalizeWorldAsset({
      id: "pc",
      name: "Cloud",
      representation: "point_cloud",
      previewPath: "worlds/color_block_room/points.ply",
      rootUri: "worlds/color_block_room",
    });
    const plan = resolveViewportRepresentation(world);
    expect(plan).toMatchObject({ kind: "point_cloud", uri: "worlds/color_block_room/points.ply" });
    expect(viewportPreviewBadge(plan)).toBe("point cloud");
  });

  it("reports unsupported for point-cloud worlds without a ply artifact", () => {
    const world = normalizeWorldAsset({
      id: "pc-empty",
      name: "Cloud",
      representation: "point_cloud",
      rootUri: "worlds/pc",
    });
    const plan = resolveViewportRepresentation(world);
    expect(plan.kind).toBe("unsupported");
    expect(plan.reason).toMatch(/point cloud/i);
  });

  it("keeps mesh plan when a stub glb exists alongside a source image", () => {
    const world = normalizeWorldAsset({
      id: "stub",
      name: "Stub",
      representation: "hybrid",
      surfaceMeshPath: "artifacts/job/surface_mesh.glb",
      previewPath: "artifacts/job/surface_mesh.glb",
      previewUri: "artifacts/job/surface_mesh.glb",
      rootUri: "artifacts/job/surface_mesh.glb",
      sourceAssetIds: ["asset-img"],
    });
    const assets = {
      "asset-img": createAssetRecord({
        id: "asset-img",
        type: "image",
        name: "hero.png",
        uri: "data:image/png;base64,aaa",
      }),
    };
    expect(resolveViewportRepresentation(world).kind).toBe("mesh");
    expect(viewportImageUris(world, assets)).toEqual(["data:image/png;base64,aaa"]);
    expect(viewportPreviewBadge(resolveViewportRepresentation(world))).toBe("mesh");
    expect(viewportPreviewBadge(resolveViewportRepresentation(world), true)).toBe("image proxy");
  });
});

describe("worldOverlayAvailability", () => {
  it("keeps apartment walkable/prop overlays unavailable when the fixture has no zone or socket", () => {
    const apartment = normalizeWorldAsset({
      id: "world-apartment-livingroom",
      name: "Apartment Livingroom",
      rootUri: "worlds/apartment_livingroom",
      elements: [
        { id: "elem-room-living", name: "Living Room Zone", kind: "room", description: "" },
        { id: "elem-actor-mark-a", name: "Actor Mark A", kind: "actor_mark", description: "" },
        { id: "elem-camera-anchor-wide", name: "Camera Anchor Wide", kind: "camera_anchor", description: "" },
        { id: "elem-light-socket-window", name: "Window Light Socket", kind: "light_socket", description: "" },
        { id: "elem-material-window", name: "Window Glass Material", kind: "material_slot", description: "" },
      ],
    });
    const availability = worldOverlayAvailability(apartment);
    expect(availability.actorMarks.available).toBe(true);
    expect(availability.cameraAnchors.available).toBe(true);
    expect(availability.lightSockets.available).toBe(true);
    expect(availability.propSockets.available).toBe(false);
    expect(availability.walkableZones.available).toBe(false);
    expect(availability.walkableZones.reason).toBeTruthy();
    expect(overlayKindForElement("room")).toBeUndefined();
    expect(overlayKindForElement("material_slot")).toBeUndefined();
    expect(worldOverlayMarkerElements(apartment).map((element) => element.kind)).toEqual([
      "actor_mark",
      "camera_anchor",
      "light_socket",
    ]);
  });
});
