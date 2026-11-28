import * as THREE from "three";
import {
  collectSkinnedMeshBoneNames,
  gltfRigNodeName,
  type SkinnedMeshNodeSource,
  type SkinnedMeshSkeletonSource,
} from "../../presentation/viewport/skinnedMeshBones";

// GLTFLoader builds one Skeleton per glTF skin, so meshes that share joints get separate Skeletons.
const rigKey = (skeleton: THREE.Skeleton): string => skeleton.bones.map((bone) => bone.uuid).join();

const nodeFromObject = (
  object: THREE.Object3D,
  shared: Map<string, SkinnedMeshSkeletonSource>,
): SkinnedMeshNodeSource => {
  if (!(object instanceof THREE.SkinnedMesh)) {
    return { name: object.name, children: object.children.map((child) => nodeFromObject(child, shared)) };
  }
  const key = rigKey(object.skeleton);
  let skeleton = shared.get(key);
  if (!skeleton) {
    skeleton = { bones: object.skeleton.bones.map((bone) => ({ name: bone.name })) };
    shared.set(key, skeleton);
  }
  return {
    name: object.name,
    isSkinnedMesh: true,
    skeleton,
    children: object.children.map((child) => nodeFromObject(child, shared)),
  };
};

export type GlbRigRead = {
  nodeName: string;
  bones: { name: string }[];
  restTranslation: [number, number, number];
  restRotation: [number, number, number, number];
  restScale: [number, number, number];
};

/**
 * Read joint names and the file-root rest pose from a loaded glTF scene.
 * Rest values stay in the glTF frame. World converts them.
 */
export const readGlbRig = (root: THREE.Object3D): GlbRigRead => {
  const node = nodeFromObject(root, new Map());
  const restTranslation: [number, number, number] = [root.position.x, root.position.y, root.position.z];
  const restRotation: [number, number, number, number] = [
    root.quaternion.x,
    root.quaternion.y,
    root.quaternion.z,
    root.quaternion.w,
  ];
  const restScale: [number, number, number] = [root.scale.x, root.scale.y, root.scale.z];
  return {
    nodeName: gltfRigNodeName(node),
    bones: collectSkinnedMeshBoneNames(node),
    restTranslation,
    restRotation,
    restScale,
  };
};
