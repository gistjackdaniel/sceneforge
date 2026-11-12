import * as THREE from "three";
import type { CameraFrame } from "./cameraTakeSource";
import { buildFrameProxies, disposeFrameProxies, type ProxyMesh } from "./proxies";
import { ALBEDO, lightDirection, shadeByte } from "./shading";
import type { Shot } from "../shot/types";
import type { FramePasses, InstanceIdEntry, RenderPassSpec } from "./types";
import { RENDER_PASS_FORMAT } from "./types";

const linearCameraZ = (camera: CameraFrame, point: THREE.Vector3): number => {
  const delta = point.clone().sub(new THREE.Vector3(camera.position[0], camera.position[1], camera.position[2]));
  const inverse = new THREE.Quaternion(camera.rotation[0], camera.rotation[1], camera.rotation[2], camera.rotation[3]).invert();
  delta.applyQuaternion(inverse);
  return -delta.z;
};

const outwardNormal = (mesh: ProxyMesh, point: THREE.Vector3, rayDirection: THREE.Vector3): THREE.Vector3 => {
  const local = mesh.worldToLocal(point.clone());
  const ax = Math.abs(local.x);
  const ay = Math.abs(local.y);
  const az = Math.abs(local.z);
  const normal = new THREE.Vector3();
  if (ax >= ay && ax >= az) normal.set(local.x < 0 ? -1 : 1, 0, 0);
  else if (ay >= az) normal.set(0, local.y < 0 ? -1 : 1, 0);
  else normal.set(0, 0, local.z < 0 ? -1 : 1);
  normal.transformDirection(mesh.matrixWorld).normalize();
  if (normal.dot(rayDirection) > 0) normal.negate();
  return normal;
};

/**
 * Headless reference. One ray per pixel center through the GL pinhole
 * (`-Z` look, `+Y` up). Depth is linear camera-space z in meters (positive
 * in front of the camera). This is the bit-stable contract.
 */
export const traceFrame = (
  shot: Shot,
  camera: CameraFrame,
  spec: RenderPassSpec,
  table: readonly InstanceIdEntry[],
): FramePasses => {
  const width = spec.width;
  const height = spec.height;
  const { root, meshes } = buildFrameProxies(shot, camera.frame, table);
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = Infinity;
  const origin = new THREE.Vector3(camera.position[0], camera.position[1], camera.position[2]);
  const rotation = new THREE.Quaternion(camera.rotation[0], camera.rotation[1], camera.rotation[2], camera.rotation[3]);
  const light = lightDirection();
  const { fx, fy, cx, cy } = camera.intrinsics;

  const rgb = new Uint8Array(width * height * 3);
  const depth = new Float32Array(width * height);
  const normal = new Float32Array(width * height * 3);
  const world = new Float32Array(width * height * 3);
  const ids = new Uint32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const direction = new THREE.Vector3(
        (x + 0.5 - cx) / fx,
        -((y + 0.5 - cy) / fy),
        -1,
      ).normalize().applyQuaternion(rotation);
      raycaster.set(origin, direction);
      const hits = raycaster.intersectObjects(meshes, false);
      const pixel = y * width + x;
      for (const hit of hits) {
        const viewZ = linearCameraZ(camera, hit.point);
        if (viewZ < spec.near || viewZ > spec.far) continue;
        const mesh = hit.object as ProxyMesh;
        const faceNormal = outwardNormal(mesh, hit.point, direction);
        const albedo = ALBEDO[mesh.userData.role];
        rgb[pixel * 3] = shadeByte(albedo[0], faceNormal, light);
        rgb[pixel * 3 + 1] = shadeByte(albedo[1], faceNormal, light);
        rgb[pixel * 3 + 2] = shadeByte(albedo[2], faceNormal, light);
        depth[pixel] = viewZ;
        normal[pixel * 3] = faceNormal.x;
        normal[pixel * 3 + 1] = faceNormal.y;
        normal[pixel * 3 + 2] = faceNormal.z;
        world[pixel * 3] = hit.point.x;
        world[pixel * 3 + 1] = hit.point.y;
        world[pixel * 3 + 2] = hit.point.z;
        ids[pixel] = mesh.userData.instanceIndex;
        break;
      }
    }
  }
  disposeFrameProxies(root);

  return {
    frame: camera.frame,
    rgb: { kind: "rgb", width, height, format: RENDER_PASS_FORMAT.rgb, data: rgb },
    depth: { kind: "depth", width, height, format: RENDER_PASS_FORMAT.depth, data: depth },
    normal: { kind: "normal", width, height, format: RENDER_PASS_FORMAT.normal, data: normal },
    world_position: { kind: "world_position", width, height, format: RENDER_PASS_FORMAT.world_position, data: world },
    instance_id: { kind: "instance_id", width, height, format: RENDER_PASS_FORMAT.instance_id, data: ids, table },
  };
};
