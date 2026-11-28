import * as THREE from "three";
import { sampleSubjectPose } from "../shot/queries";
import type { Shot, Vec3 } from "../shot/types";
import type { InstanceIdEntry } from "./types";

/** Closed shell around the phase-0 set. The instance id is the room id, not a subject. */
export const ROOM_SHELL = {
  min: [-0.5, 0, -2.2] as Vec3,
  max: [3.8, 3.2, 3.6] as Vec3,
  thickness: 0.05,
};

/**
 * Upright body plus a hand pivoted at the shoulder.
 * `rotationEuler` / `scale` on an explicit key pose the hand only
 * (contact hand). Root translation is the key position.
 * Changing these sizes changes pixels and requires a renderer version bump.
 */
const ACTOR_BODY = { size: [0.36, 1.2, 0.2] as Vec3, center: [0, 0.75, 0] as Vec3 };
const ACTOR_HAND = {
  size: [0.14, 0.1, 0.18] as Vec3,
  pivot: [0.22, 1.0, 0.08] as Vec3,
  offset: [0.48, 0, 0] as Vec3,
};

export type ProxyMesh = THREE.Mesh & {
  userData: { persistentId: string; instanceIndex: number; role: InstanceIdEntry["role"] };
};

const tag = (mesh: THREE.Mesh, entry: InstanceIdEntry): ProxyMesh => {
  mesh.userData = { persistentId: entry.persistentId, instanceIndex: entry.index, role: entry.role };
  mesh.frustumCulled = false;
  mesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  return mesh as ProxyMesh;
};

const unitBox = (): THREE.BoxGeometry => new THREE.BoxGeometry(1, 1, 1);

const slab = (
  center: Vec3,
  size: Vec3,
  entry: InstanceIdEntry,
): ProxyMesh => {
  const mesh = new THREE.Mesh(unitBox());
  mesh.position.set(center[0], center[1], center[2]);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.rotation.set(0, 0, 0, "XYZ");
  return tag(mesh, entry);
};

const roomMeshes = (entry: InstanceIdEntry): ProxyMesh[] => {
  const { min, max, thickness } = ROOM_SHELL;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  return [
    slab([cx, min[1] + thickness / 2, cz], [sx, thickness, sz], entry),
    slab([cx, max[1] - thickness / 2, cz], [sx, thickness, sz], entry),
    slab([min[0] + thickness / 2, cy, cz], [thickness, sy, sz], entry),
    slab([max[0] - thickness / 2, cy, cz], [thickness, sy, sz], entry),
    slab([cx, cy, min[2] + thickness / 2], [sx, sy, thickness], entry),
    slab([cx, cy, max[2] - thickness / 2], [sx, sy, thickness], entry),
  ];
};

const actorMeshes = (
  shot: Shot,
  subjectId: string,
  frame: number,
  entry: InstanceIdEntry,
): { nodes: THREE.Object3D[]; meshes: ProxyMesh[] } => {
  const subject = shot.subjects.find((item) => item.id === subjectId);
  if (!subject || subject.kind === "light") return { nodes: [], meshes: [] };
  const pose = sampleSubjectPose(subject, frame);
  const body = new THREE.Mesh(unitBox());
  body.position.set(
    pose.position[0] + ACTOR_BODY.center[0],
    pose.position[1] + ACTOR_BODY.center[1],
    pose.position[2] + ACTOR_BODY.center[2],
  );
  body.scale.set(ACTOR_BODY.size[0], ACTOR_BODY.size[1], ACTOR_BODY.size[2]);
  body.rotation.set(0, 0, 0, "XYZ");

  const pivot = new THREE.Object3D();
  pivot.position.set(
    pose.position[0] + ACTOR_HAND.pivot[0],
    pose.position[1] + ACTOR_HAND.pivot[1],
    pose.position[2] + ACTOR_HAND.pivot[2],
  );
  pivot.rotation.set(pose.rotationEuler[0], pose.rotationEuler[1], pose.rotationEuler[2], "XYZ");
  const hand = new THREE.Mesh(unitBox());
  hand.position.set(
    ACTOR_HAND.offset[0] * pose.scale[0],
    ACTOR_HAND.offset[1] * pose.scale[1],
    ACTOR_HAND.offset[2] * pose.scale[2],
  );
  hand.scale.set(
    ACTOR_HAND.size[0] * pose.scale[0],
    ACTOR_HAND.size[1] * pose.scale[1],
    ACTOR_HAND.size[2] * pose.scale[2],
  );
  pivot.add(hand);
  const bodyMesh = tag(body, entry);
  const handMesh = tag(hand, entry);
  return { nodes: [bodyMesh, pivot], meshes: [bodyMesh, handMesh] };
};

const objectMesh = (shot: Shot, subjectId: string, frame: number, entry: InstanceIdEntry): ProxyMesh | undefined => {
  const subject = shot.subjects.find((item) => item.id === subjectId);
  if (!subject || subject.kind === "light") return undefined;
  const pose = sampleSubjectPose(subject, frame);
  const mesh = new THREE.Mesh(unitBox());
  mesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
  mesh.rotation.set(pose.rotationEuler[0], pose.rotationEuler[1], pose.rotationEuler[2], "XYZ");
  mesh.scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);
  return tag(mesh, entry);
};

/** Oriented boxes for one integer frame. Matrices are current. */
export const buildFrameProxies = (
  shot: Shot,
  frame: number,
  table: readonly InstanceIdEntry[],
): { root: THREE.Group; meshes: ProxyMesh[] } => {
  const meshes: ProxyMesh[] = [];
  const root = new THREE.Group();
  for (const entry of table) {
    if (entry.role === "room") {
      const walls = roomMeshes(entry);
      walls.forEach((mesh) => root.add(mesh));
      meshes.push(...walls);
      continue;
    }
    if (entry.role === "actor") {
      const parts = actorMeshes(shot, entry.persistentId, frame, entry);
      parts.nodes.forEach((node) => root.add(node));
      meshes.push(...parts.meshes);
      continue;
    }
    const box = objectMesh(shot, entry.persistentId, frame, entry);
    if (box) {
      root.add(box);
      meshes.push(box);
    }
  }
  root.updateMatrixWorld(true);
  return { root, meshes };
};

export const disposeFrameProxies = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
};
