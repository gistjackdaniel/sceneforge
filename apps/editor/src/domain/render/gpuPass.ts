import * as THREE from "three";
import type { CameraFrame } from "./cameraTakeSource";
import { buildFrameProxies, disposeFrameProxies, type ProxyMesh } from "./proxies";
import { ALBEDO, LIGHT_VECTOR } from "./shading";
import type { Shot } from "../shot/types";
import type { FramePasses, InstanceIdEntry, RenderPassKind, RenderPassSpec } from "./types";
import { RENDER_PASS_FORMAT } from "./types";

const lightLiteral = LIGHT_VECTOR.map((value) => value.toExponential(8)).join(", ");

const worldNormalFunction = /* glsl */`
vec3 protectedWorldNormal(vec3 objectNormal) {
  mat3 model = mat3(modelMatrix);
  vec3 c0 = cross(model[1], model[2]);
  vec3 c1 = cross(model[2], model[0]);
  vec3 c2 = cross(model[0], model[1]);
  return normalize(mat3(c0, c1, c2) * objectNormal);
}
`;

const depthMaterial = (): THREE.MeshDepthMaterial => {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide });
  material.toneMapped = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("varying vec2 vHighPrecisionZW;", "varying vec2 vHighPrecisionZW;\nvarying float vLinearViewZ;")
      .replace("vHighPrecisionZW = gl_Position.zw;", "vHighPrecisionZW = gl_Position.zw;\n\tvLinearViewZ = -mvPosition.z;");
    shader.fragmentShader = shader.fragmentShader
      .replace("varying vec2 vHighPrecisionZW;", "varying vec2 vHighPrecisionZW;\nvarying float vLinearViewZ;")
      .replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "gl_FragColor = vec4( vLinearViewZ, 0.0, 0.0, 1.0 );",
      );
  };
  return material;
};

const normalMaterial = (): THREE.MeshNormalMaterial => {
  const material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  material.toneMapped = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <normal_pars_vertex>", `#include <normal_pars_vertex>\nvarying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\n${worldNormalFunction}`)
      .replace(
        "#include <normal_vertex>",
        `#include <normal_vertex>
        vWorldNormal = protectedWorldNormal(objectNormal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <normal_pars_fragment>", "#include <normal_pars_fragment>\nvarying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;")
      .replace(
        "gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );",
        `vec3 facing = normalize(vWorldNormal);
         if (dot(facing, normalize(cameraPosition - vWorldPosition)) < 0.0) facing = -facing;
         gl_FragColor = vec4(facing, 1.0);`,
      );
  };
  return material;
};

const worldMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  toneMapped: false,
  vertexShader: /* glsl */`
    varying vec3 vWorldPosition;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPosition = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vWorldPosition;
    void main() {
      gl_FragColor = vec4(vWorldPosition, 1.0);
    }
  `,
});

const rgbMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  toneMapped: false,
  uniforms: { albedo: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: /* glsl */`
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    ${worldNormalFunction}
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPosition = world.xyz;
      vWorldNormal = protectedWorldNormal(normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 albedo;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    void main() {
      vec3 lightDir = normalize(vec3(${lightLiteral}));
      vec3 facing = normalize(vWorldNormal);
      if (dot(facing, normalize(cameraPosition - vWorldPosition)) < 0.0) facing = -facing;
      float shade = 0.18 + 0.82 * clamp(dot(facing, lightDir), 0.0, 1.0);
      gl_FragColor = vec4(albedo * shade, 1.0);
    }
  `,
});

const idMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  toneMapped: false,
  uniforms: { instanceIndex: { value: 0 } },
  vertexShader: /* glsl */`
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float instanceIndex;
    void main() {
      gl_FragColor = vec4(instanceIndex, 0.0, 0.0, 1.0);
    }
  `,
});

const perspectiveCamera = (frame: CameraFrame, spec: RenderPassSpec): THREE.PerspectiveCamera => {
  const fov = (2 * Math.atan((spec.height / 2) / frame.intrinsics.fy) * 180) / Math.PI;
  const camera = new THREE.PerspectiveCamera(fov, spec.width / spec.height, spec.near, spec.far);
  camera.position.set(frame.position[0], frame.position[1], frame.position[2]);
  camera.quaternion.set(frame.rotation[0], frame.rotation[1], frame.rotation[2], frame.rotation[3]);
  camera.updateMatrixWorld(true);
  return camera;
};

const readFloat = (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, width: number, height: number): Float32Array => {
  const raw = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
  const flipped = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = (height - 1 - y) * width * 4;
    flipped.set(raw.subarray(from, from + width * 4), y * width * 4);
  }
  return flipped;
};

const bindMeshUniforms = (meshes: readonly ProxyMesh[], rgb: THREE.ShaderMaterial, ids: THREE.ShaderMaterial) => {
  for (const mesh of meshes) {
    const albedo = ALBEDO[mesh.userData.role];
    const index = mesh.userData.instanceIndex;
    mesh.onBeforeRender = () => {
      rgb.uniforms.albedo?.value.setRGB(albedo[0] / 255, albedo[1] / 255, albedo[2] / 255);
      if (ids.uniforms.instanceIndex) ids.uniforms.instanceIndex.value = index;
    };
  }
};

/**
 * Offscreen WebGL passes. Override materials: MeshDepthMaterial (linear view z),
 * MeshNormalMaterial (world unit normal), plus world-position and instance-index shaders.
 * Pixel coverage can differ from the reference ray on silhouettes. The bit-stable
 * contract is `traceFrame`.
 */
export const traceFramesGpu = (
  shot: Shot,
  cameras: readonly CameraFrame[],
  spec: RenderPassSpec,
  table: readonly InstanceIdEntry[],
): { ok: true; frames: FramePasses[] } | { ok: false; reason: string } => {
  if (typeof OffscreenCanvas === "undefined") {
    return { ok: false, reason: "WebGL render pass needs OffscreenCanvas." };
  }
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    const canvas = new OffscreenCanvas(spec.width, spec.height);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: true, stencil: false });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return { ok: false, reason: `WebGL render pass is unavailable (${name}).` };
  }
  const { width, height } = spec;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const depth = depthMaterial();
  const normal = normalMaterial();
  const world = worldMaterial();
  const rgb = rgbMaterial();
  const ids = idMaterial();
  const overrides: Record<RenderPassKind, THREE.Material> = {
    rgb,
    depth,
    normal,
    world_position: world,
    instance_id: ids,
  };
  const frames: FramePasses[] = [];
  try {
    for (const cameraFrame of cameras) {
      const { root, meshes } = buildFrameProxies(shot, cameraFrame.frame, table);
      bindMeshUniforms(meshes, rgb, ids);
      const scene = new THREE.Scene();
      scene.add(root);
      const camera = perspectiveCamera(cameraFrame, spec);
      const buffers = {
        rgb: new Uint8Array(width * height * 3),
        depth: new Float32Array(width * height),
        normal: new Float32Array(width * height * 3),
        world: new Float32Array(width * height * 3),
        ids: new Uint32Array(width * height),
      };
      (Object.keys(overrides) as RenderPassKind[]).forEach((kind) => {
        scene.overrideMaterial = overrides[kind] ?? null;
        renderer?.setRenderTarget(target);
        renderer?.clear();
        renderer?.render(scene, camera);
        if (!renderer) return;
        const pixels = readFloat(renderer, target, width, height);
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const texel = pixel * 4;
          if (kind === "rgb") {
            buffers.rgb[pixel * 3] = Math.min(255, Math.max(0, Math.round((pixels[texel] ?? 0) * 255)));
            buffers.rgb[pixel * 3 + 1] = Math.min(255, Math.max(0, Math.round((pixels[texel + 1] ?? 0) * 255)));
            buffers.rgb[pixel * 3 + 2] = Math.min(255, Math.max(0, Math.round((pixels[texel + 2] ?? 0) * 255)));
          } else if (kind === "depth") {
            buffers.depth[pixel] = pixels[texel] ?? 0;
          } else if (kind === "normal") {
            buffers.normal[pixel * 3] = pixels[texel] ?? 0;
            buffers.normal[pixel * 3 + 1] = pixels[texel + 1] ?? 0;
            buffers.normal[pixel * 3 + 2] = pixels[texel + 2] ?? 0;
          } else if (kind === "world_position") {
            buffers.world[pixel * 3] = pixels[texel] ?? 0;
            buffers.world[pixel * 3 + 1] = pixels[texel + 1] ?? 0;
            buffers.world[pixel * 3 + 2] = pixels[texel + 2] ?? 0;
          } else {
            buffers.ids[pixel] = Math.max(0, Math.round(pixels[texel] ?? 0));
          }
        }
      });
      scene.overrideMaterial = null;
      disposeFrameProxies(root);
      frames.push({
        frame: cameraFrame.frame,
        rgb: { kind: "rgb", width, height, format: RENDER_PASS_FORMAT.rgb, data: buffers.rgb },
        depth: { kind: "depth", width, height, format: RENDER_PASS_FORMAT.depth, data: buffers.depth },
        normal: { kind: "normal", width, height, format: RENDER_PASS_FORMAT.normal, data: buffers.normal },
        world_position: { kind: "world_position", width, height, format: RENDER_PASS_FORMAT.world_position, data: buffers.world },
        instance_id: { kind: "instance_id", width, height, format: RENDER_PASS_FORMAT.instance_id, data: buffers.ids, table },
      });
    }
  } finally {
    target.dispose();
    depth.dispose();
    normal.dispose();
    world.dispose();
    rgb.dispose();
    ids.dispose();
    renderer.dispose();
  }
  return { ok: true, frames };
};
