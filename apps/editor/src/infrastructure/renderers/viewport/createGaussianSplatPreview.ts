import * as THREE from "three";
import type { ParsedPly } from "./parsePly";

const vertexShader = `
  attribute vec3 instanceColor;
  attribute float instanceOpacity;
  attribute float instanceRadius;
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vUv;

  void main() {
    vColor = instanceColor;
    vOpacity = instanceOpacity;
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 quad = (uv - 0.5) * instanceRadius * 2.0;
    mvPosition.xy += quad;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vUv;

  void main() {
    vec2 delta = vUv * 2.0 - 1.0;
    float gaussian = exp(-4.5 * dot(delta, delta));
    if (gaussian < 0.04) {
      discard;
    }
    gl_FragColor = vec4(vColor, vOpacity * gaussian);
  }
`;

export const createGaussianSplatPreview = (parsed: ParsedPly): THREE.InstancedMesh => {
  const count = parsed.vertices.length;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const radii = new Float32Array(count);
  parsed.vertices.forEach((vertex, index) => {
    colors[index * 3] = vertex.r;
    colors[index * 3 + 1] = vertex.g;
    colors[index * 3 + 2] = vertex.b;
    opacities[index] = vertex.hasGaussian ? vertex.opacity : 0.85;
    radii[index] = vertex.hasGaussian
      ? Math.max(vertex.scale[0], vertex.scale[1], vertex.scale[2]) * 2.2
      : 0.08;
  });
  geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute("instanceOpacity", new THREE.InstancedBufferAttribute(opacities, 1));
  geometry.setAttribute("instanceRadius", new THREE.InstancedBufferAttribute(radii, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "gaussian-splat-preview";
  const dummy = new THREE.Object3D();
  parsed.vertices.forEach((vertex, index) => {
    dummy.position.set(vertex.x, vertex.y, vertex.z);
    dummy.quaternion.set(vertex.rotation[1], vertex.rotation[2], vertex.rotation[3], vertex.rotation[0]);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
};
