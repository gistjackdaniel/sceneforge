import { Mesh, SkinnedMesh, Texture, type Material, type Object3D, type Skeleton } from "three";

export function disposeMeshResources(root: Object3D): void {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<Skeleton>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => materials.add(material));
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
  });
  for (const material of materials) {
    for (const property of Object.values(material)) {
      if (property instanceof Texture) textures.add(property);
    }
    material.dispose();
  }
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
  for (const skeleton of skeletons) skeleton.dispose();
}
