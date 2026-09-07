import * as THREE from "three";
import type { ParsedPly } from "./parsePly";

export const createPointCloudPreview = (parsed: ParsedPly): THREE.Points => {
  const positions = new Float32Array(parsed.vertices.length * 3);
  const colors = new Float32Array(parsed.vertices.length * 3);
  parsed.vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
    colors[index * 3] = vertex.r;
    colors[index * 3 + 1] = vertex.g;
    colors[index * 3 + 2] = vertex.b;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.045,
    vertexColors: true,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "point-cloud-preview";
  return points;
};
