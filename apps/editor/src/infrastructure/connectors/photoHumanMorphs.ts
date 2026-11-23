import { Float32BufferAttribute, SkinnedMesh, type BufferGeometry, type Object3D } from "three";

const symmetricChannels = new Set([
  "mouthDimple", "mouthFrown", "mouthLowerDown", "mouthPress", "mouthSmile", "mouthStretch", "mouthUpperUp",
]);

export function preparePhotoHumanExpressions(root: Object3D) {
  root.traverse((node) => {
    if (!(node instanceof SkinnedMesh)) return;
    const geometry: BufferGeometry = node.geometry;
    const { morphTargetDictionary } = node;
    const targets = geometry.morphAttributes.position;
    if (!targets?.length || !morphTargetDictionary) return;
    const base = geometry.getAttribute("position");
    const names = Object.fromEntries(Object.entries(morphTargetDictionary).map(([name, index]) => [index, name]));
    geometry.morphAttributes.position = targets.flatMap((target, index) => {
      const name = names[index];
      if (!symmetricChannels.has(name)) {
        target.name = name;
        return [target];
      }
      const left = new Float32BufferAttribute(target.count * 3, 3);
      const right = new Float32BufferAttribute(target.count * 3, 3);
      left.name = `${name}Left`;
      right.name = `${name}Right`;
      for (let vertex = 0; vertex < target.count; vertex++) {
        const leftWeight = Math.min(1, Math.max(0, 0.5 + base.getX(vertex) * 80));
        const rightWeight = 1 - leftWeight;
        const x = target.getX(vertex), y = target.getY(vertex), z = target.getZ(vertex);
        left.setXYZ(vertex, x * leftWeight, y * leftWeight, z * leftWeight);
        right.setXYZ(vertex, x * rightWeight, y * rightWeight, z * rightWeight);
      }
      return [left, right];
    });
    node.updateMorphTargets();
  });
}
