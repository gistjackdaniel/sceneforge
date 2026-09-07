import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  overlayKindForElement,
  viewportPreviewBadge,
  worldOverlayMarkerElements,
  type OverlayKind,
  type ViewportLoadState,
  type ViewportRepresentationPlan,
} from "../../domain/worlds/viewportRepresentation";
import {
  createGaussianSplatPreview,
  createPointCloudPreview,
  parsePly,
} from "../../infrastructure/renderers/viewport";
import type { WorldAsset, WorldElement } from "../../domain/worlds/types";
import type { ViewportTool, ViewportWorkspace, CameraVizState } from "../../state/editorStore";
import type { CameraKeyframe } from "../../domain/graph/cameraPath";

export interface StageObjectTransform {
  id: string;
  kind: "actor" | "prop" | "light";
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface StageCameraPose {
  position: [number, number, number];
  rotation: [number, number, number];
  focalLength: number;
}

export interface ViewportSelection {
  id: string;
  kind: "actor" | "prop" | "light" | "camera";
  layer: "clip";
  position: [number, number, number];
  rotation: [number, number, number];
}

interface StageViewportProps {
  world?: WorldAsset;
  worldName?: string;
  previewPlan: ViewportRepresentationPlan;
  fallbackImageUri?: string;
  overlays: Record<OverlayKind, boolean>;
  tool: ViewportTool;
  workspace: ViewportWorkspace;
  outputAspect: number;
  outputAspectLabel?: string;
  cameraViz: CameraVizState;
  cameraPose?: StageCameraPose;
  objectTransforms?: StageObjectTransform[];
  keyframes?: CameraKeyframe[];
  pathSamples?: Array<[number, number, number]>;
  lookAtTargetId?: string;
  fovDegrees?: number;
  playheadFrame?: number;
  onTransformCommit?: (payload: {
    worldElementId: string;
    kind: "actor" | "prop" | "light" | "camera";
    position: [number, number, number];
    rotation: [number, number, number];
    scale?: [number, number, number];
  }) => void;
  onSelectionChange?: (selection: ViewportSelection | undefined) => void;
  onLoadStateChange?: (state: ViewportLoadState, message?: string) => void;
  onCapturePose?: (payload: { camera: StageCameraPose; objects: StageObjectTransform[] }) => void;
  captureSignal?: number;
  focusSignal?: number;
  resetSignal?: number;
}

const kindFromElement = (element: WorldElement): "actor" | "prop" | "light" => {
  if (element.kind === "actor_mark") {
    return "actor";
  }
  if (element.kind === "light_socket") {
    return "light";
  }
  return "prop";
};

const resolveMediaUri = (uri: string): string =>
  uri.startsWith("data:") || uri.startsWith("blob:") || uri.startsWith("http") || uri.startsWith("/")
    ? uri
    : `/${uri}`;

type FlyKeys = {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
  shift: boolean;
};

const emptyFlyKeys = (): FlyKeys => ({
  w: false,
  a: false,
  s: false,
  d: false,
  q: false,
  e: false,
  shift: false,
});

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

const applyRecordFly = (camera: THREE.PerspectiveCamera, keys: FlyKeys, delta: number): boolean => {
  const moving = keys.w || keys.a || keys.s || keys.d || keys.q || keys.e;
  if (!moving) {
    return false;
  }
  const speed = (keys.shift ? 6.5 : 2.6) * delta;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  if (right.lengthSq() > 1e-6) {
    right.normalize();
  } else {
    right.set(1, 0, 0);
  }
  const worldUp = new THREE.Vector3(0, 1, 0);
  if (keys.w) camera.position.addScaledVector(forward, speed);
  if (keys.s) camera.position.addScaledVector(forward, -speed);
  if (keys.d) camera.position.addScaledVector(right, speed);
  if (keys.a) camera.position.addScaledVector(right, -speed);
  if (keys.e) camera.position.addScaledVector(worldUp, speed);
  if (keys.q) camera.position.addScaledVector(worldUp, -speed);
  return true;
};

const applyRecordLook = (camera: THREE.PerspectiveCamera, dx: number, dy: number): void => {
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  euler.y -= dx * 0.0022;
  euler.x -= dy * 0.0022;
  euler.x = Math.max(-Math.PI / 2 + 0.04, Math.min(Math.PI / 2 - 0.04, euler.x));
  camera.quaternion.setFromEuler(euler);
};

export const StageViewport = ({
  world,
  worldName,
  previewPlan,
  fallbackImageUri,
  overlays,
  tool,
  workspace,
  outputAspect = 16 / 9,
  outputAspectLabel = "16:9",
  cameraViz = {
    frustum: true,
    path: true,
    lookAtLine: true,
    keyframeMarkers: true,
  },
  cameraPose,
  objectTransforms = [],
  keyframes = [],
  pathSamples = [],
  lookAtTargetId,
  fovDegrees = 50,
  playheadFrame = 0,
  onTransformCommit,
  onSelectionChange,
  onLoadStateChange,
  onCapturePose,
  captureSignal = 0,
  focusSignal = 0,
  resetSignal = 0,
}: StageViewportProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTransformCommitRef = useRef(onTransformCommit);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  const onCapturePoseRef = useRef(onCapturePose);
  onTransformCommitRef.current = onTransformCommit;
  onSelectionChangeRef.current = onSelectionChange;
  onLoadStateChangeRef.current = onLoadStateChange;
  onCapturePoseRef.current = onCapturePose;
  const workspaceRef = useRef(workspace);
  const toolRef = useRef(tool);
  const outputAspectRef = useRef(outputAspect);
  const flyKeysRef = useRef<FlyKeys>(emptyFlyKeys());
  const liveOverrideRef = useRef(false);
  const lastPlayheadRef = useRef(playheadFrame);
  const lookingRef = useRef(false);
  const buildViewRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const [showingImageProxy, setShowingImageProxy] = useState(false);
  workspaceRef.current = workspace;
  toolRef.current = tool;
  outputAspectRef.current = outputAspect;

  const recording = workspace === "record";
  const sceneApiRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    transform: TransformControls;
    renderer: THREE.WebGLRenderer;
    objects: Map<string, THREE.Object3D>;
    objectKinds: Map<string, "actor" | "prop" | "light" | "camera">;
    worldRoot: THREE.Object3D | null;
    shotCamera: THREE.Object3D;
    shotBody: THREE.Object3D;
    helperCam: THREE.PerspectiveCamera;
    frustumHelper: THREE.CameraHelper;
    pathLine: THREE.Line;
    lookAtLine: THREE.Line;
    playheadMarker: THREE.Mesh;
    keyframeGroup: THREE.Group;
    stageFloor: THREE.Object3D;
    grid: THREE.Object3D;
    dragging: boolean;
  } | null>(null);
  const loadTokenRef = useRef(0);
  const [hud, setHud] = useState(worldName ?? "No world");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const width = container.clientWidth;
    const height = container.clientHeight || 320;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(2.5, 1.8, 3.2);
    camera.lookAt(0, 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.6, 0);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    scene.add(transform.getHelper());

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const keyLight = new THREE.DirectionalLight(0x7ee8ff, 1.2);
    keyLight.position.set(3, 5, 2);
    scene.add(keyLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x151b24 }),
    );
    floor.rotation.x = -Math.PI / 2;
    const grid = new THREE.GridHelper(12, 24, 0x00c2ff, 0x1e2a38);
    scene.add(floor);
    scene.add(grid);

    const shotCamera = new THREE.Group();
    shotCamera.name = "shot-camera";
    shotCamera.position.set(2.5, 1.8, 3.2);
    const shotBody = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.28, 12),
      new THREE.MeshStandardMaterial({ color: 0x79c0ff }),
    );
    shotBody.rotation.x = Math.PI / 2;
    shotCamera.add(shotBody);
    const helperCam = new THREE.PerspectiveCamera(50, outputAspect, 0.12, 3.5);
    shotCamera.add(helperCam);
    scene.add(shotCamera);
    const frustumHelper = new THREE.CameraHelper(helperCam);
    scene.add(frustumHelper);
    const pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x79c0ff }),
    );
    scene.add(pathLine);
    const lookAtLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffa657 }),
    );
    scene.add(lookAtLine);
    const playheadMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff7b72, emissive: 0x4d1f1c }),
    );
    scene.add(playheadMarker);

    const keyframeGroup = new THREE.Group();
    scene.add(keyframeGroup);

    const objects = new Map<string, THREE.Object3D>([["shot-camera", shotCamera]]);
    const objectKinds = new Map<string, "actor" | "prop" | "light" | "camera">([["shot-camera", "camera"]]);

    const api = {
      scene,
      camera,
      orbit,
      transform,
      renderer,
      objects,
      objectKinds,
      worldRoot: null as THREE.Object3D | null,
      shotCamera,
      shotBody,
      helperCam,
      frustumHelper,
      pathLine,
      lookAtLine,
      playheadMarker,
      keyframeGroup,
      stageFloor: floor,
      grid,
      dragging: false,
    };
    sceneApiRef.current = api;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const pickObject = (event: PointerEvent) => {
      if (api.dragging || workspaceRef.current === "record") {
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const pickables = Array.from(objects.values());
      const hits = raycaster.intersectObjects(pickables, true);
      const raw = hits[0]?.object;
      if (!raw) {
        return;
      }
      let picked: THREE.Object3D | undefined = raw;
      while (picked && !objects.has(picked.name) && picked.parent) {
        picked = picked.parent;
      }
      if (!picked || !objects.has(picked.name)) {
        return;
      }
      transform.attach(picked);
      const id = picked.name;
      const kind = objectKinds.get(id);
      if (kind) {
        onSelectionChangeRef.current?.({
          id,
          kind,
          layer: "clip",
          position: [picked.position.x, picked.position.y, picked.position.z],
          rotation: [picked.rotation.x, picked.rotation.y, picked.rotation.z],
        });
      }
    };

    transform.addEventListener("dragging-changed", (event) => {
      api.dragging = Boolean(event.value);
      api.orbit.enabled =
        !api.dragging && workspaceRef.current === "build" && toolRef.current === "navigate";
      if (!api.dragging) {
        const attached = transform.object;
        if (!attached || !onTransformCommitRef.current) {
          return;
        }
        const id = attached.name;
        const kind = objectKinds.get(id);
        if (!kind) {
          return;
        }
        if (kind === "camera" && workspaceRef.current !== "build") {
          return;
        }
        onTransformCommitRef.current({
          worldElementId: id,
          kind,
          position: [attached.position.x, attached.position.y, attached.position.z],
          rotation: [attached.rotation.x, attached.rotation.y, attached.rotation.z],
          scale: [attached.scale.x, attached.scale.y, attached.scale.z],
        });
      }
    });
    renderer.domElement.addEventListener("pointerdown", pickObject);

    const setFlyKey = (event: KeyboardEvent, pressed: boolean) => {
      if (isTypingTarget(event.target) || workspaceRef.current !== "record") {
        return;
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "w") flyKeysRef.current.w = pressed;
      if (key === "a") flyKeysRef.current.a = pressed;
      if (key === "s") flyKeysRef.current.s = pressed;
      if (key === "d") flyKeysRef.current.d = pressed;
      if (key === "q") flyKeysRef.current.q = pressed;
      if (key === "e") flyKeysRef.current.e = pressed;
      if (key === "Shift") flyKeysRef.current.shift = pressed;
      if (pressed && ["w", "a", "s", "d", "q", "e"].includes(key)) {
        event.preventDefault();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => setFlyKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setFlyKey(event, false);
    const onBlur = () => {
      flyKeysRef.current = emptyFlyKeys();
      lookingRef.current = false;
    };
    const onContextMenu = (event: Event) => {
      if (workspaceRef.current === "record") {
        event.preventDefault();
      }
    };
    const onPointerDownLook = (event: PointerEvent) => {
      if (workspaceRef.current !== "record" || event.button !== 2) {
        return;
      }
      lookingRef.current = true;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerUpLook = (event: PointerEvent) => {
      if (event.button === 2) {
        lookingRef.current = false;
      }
    };
    const onPointerMoveLook = (event: PointerEvent) => {
      if (!lookingRef.current || workspaceRef.current !== "record") {
        return;
      }
      applyRecordLook(camera, event.movementX, event.movementY);
      liveOverrideRef.current = true;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("pointerdown", onPointerDownLook);
    renderer.domElement.addEventListener("pointerup", onPointerUpLook);
    renderer.domElement.addEventListener("pointermove", onPointerMoveLook);

    let lastFrame = performance.now();
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      if (workspaceRef.current === "record") {
        const moved = applyRecordFly(camera, flyKeysRef.current, delta);
        if (moved) {
          liveOverrideRef.current = true;
        }
        api.shotCamera.position.copy(camera.position);
        api.shotCamera.quaternion.copy(camera.quaternion);
        api.shotCamera.rotation.setFromQuaternion(camera.quaternion);
        api.shotCamera.updateMatrixWorld(true);
      } else {
        orbit.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight || 320;
      if (nextWidth < 2 || nextHeight < 2) {
        return;
      }
      camera.aspect =
        workspaceRef.current === "record" ? outputAspectRef.current : nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pickObject);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("pointerdown", onPointerDownLook);
      renderer.domElement.removeEventListener("pointerup", onPointerUpLook);
      renderer.domElement.removeEventListener("pointermove", onPointerMoveLook);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    const recording = workspace === "record";
    if (recording) {
      if (!buildViewRef.current) {
        buildViewRef.current = {
          position: api.camera.position.clone(),
          target: api.orbit.target.clone(),
        };
      }
      liveOverrideRef.current = false;
      api.camera.position.copy(api.shotCamera.position);
      api.camera.quaternion.copy(api.shotCamera.quaternion);
      api.orbit.enabled = false;
      api.transform.detach();
      api.transform.enabled = false;
      return;
    }
    const saved = buildViewRef.current;
    if (saved) {
      api.camera.position.copy(saved.position);
      api.orbit.target.copy(saved.target);
      buildViewRef.current = null;
    }
    liveOverrideRef.current = false;
    const navigate = tool === "navigate";
    api.orbit.enabled = navigate && !api.dragging;
    if (tool === "translate" || tool === "rotate" || tool === "scale") {
      api.transform.setMode(tool === "translate" ? "translate" : tool);
      api.transform.enabled = true;
    } else if (tool === "select") {
      api.transform.enabled = true;
    } else {
      api.transform.detach();
      api.transform.enabled = false;
    }
  }, [tool, workspace]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    api.helperCam.aspect = outputAspect;
    api.helperCam.updateProjectionMatrix();
    api.frustumHelper.update();
    if (workspace === "record") {
      api.camera.aspect = outputAspect;
      api.camera.updateProjectionMatrix();
    }
  }, [outputAspect, workspace]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    for (const [id, object] of api.objects) {
      if (id === "shot-camera") {
        continue;
      }
      const element = world?.elements.find((item) => item.id === id);
      const overlay = element ? overlayKindForElement(element.kind) : undefined;
      object.visible = overlay ? overlays[overlay] : false;
    }
  }, [overlays, world]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api || api.dragging) {
      return;
    }
    objectTransforms.forEach((item) => {
      const object = api.objects.get(item.id);
      if (!object) {
        return;
      }
      object.position.set(...item.position);
      object.rotation.set(...item.rotation);
    });
  }, [objectTransforms]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api || !cameraPose || api.dragging) {
      return;
    }
    if (workspace === "record" && playheadFrame !== lastPlayheadRef.current) {
      liveOverrideRef.current = false;
    }
    lastPlayheadRef.current = playheadFrame;
    if (workspace === "record" && liveOverrideRef.current) {
      api.camera.fov = fovDegrees;
      api.camera.aspect = outputAspect;
      api.camera.updateProjectionMatrix();
      api.helperCam.fov = fovDegrees;
      api.helperCam.aspect = outputAspect;
      api.helperCam.updateProjectionMatrix();
      return;
    }
    api.shotCamera.position.set(...cameraPose.position);
    api.shotCamera.rotation.set(...cameraPose.rotation);
    const lookTarget = lookAtTargetId ? api.objects.get(lookAtTargetId) : undefined;
    if (lookTarget) {
      api.shotCamera.lookAt(lookTarget.position);
    }
    api.shotCamera.updateMatrixWorld(true);
    api.helperCam.fov = fovDegrees;
    api.helperCam.aspect = outputAspect;
    api.helperCam.updateProjectionMatrix();
    api.frustumHelper.update();
    if (workspace === "record") {
      api.camera.position.copy(api.shotCamera.position);
      api.camera.quaternion.copy(api.shotCamera.quaternion);
      api.camera.fov = fovDegrees;
      api.camera.aspect = outputAspect;
      api.camera.updateProjectionMatrix();
    } else {
      api.camera.fov = 55;
      api.camera.updateProjectionMatrix();
    }
  }, [cameraPose, workspace, fovDegrees, lookAtTargetId, playheadFrame, outputAspect]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    api.shotBody.visible = workspace === "build";
    api.frustumHelper.visible = cameraViz.frustum && workspace === "build";
    api.keyframeGroup.visible = cameraViz.keyframeMarkers;
    api.pathLine.visible = cameraViz.path && pathSamples.length > 1;
    api.lookAtLine.visible = Boolean(cameraViz.lookAtLine && lookAtTargetId);
    api.playheadMarker.visible = cameraViz.path || cameraViz.keyframeMarkers;

    api.keyframeGroup.clear();
    if (cameraViz.keyframeMarkers) {
      keyframes.forEach((keyframe) => {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 12, 12),
          new THREE.MeshStandardMaterial({
            color: keyframe.frame === playheadFrame ? 0xffa657 : 0x79c0ff,
          }),
        );
        marker.position.set(...keyframe.position);
        api.keyframeGroup.add(marker);
      });
    }

    if (pathSamples.length > 0) {
      api.pathLine.geometry.dispose();
      api.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(
        pathSamples.map((point) => new THREE.Vector3(...point)),
      );
      const current = cameraPose?.position ?? pathSamples[0];
      api.playheadMarker.position.set(...current);
    }

    const lookTarget = lookAtTargetId ? api.objects.get(lookAtTargetId) : undefined;
    if (lookTarget) {
      api.lookAtLine.geometry.dispose();
      api.lookAtLine.geometry = new THREE.BufferGeometry().setFromPoints([
        api.shotCamera.position.clone(),
        lookTarget.position.clone(),
      ]);
    }
  }, [keyframes, playheadFrame, cameraViz, pathSamples, lookAtTargetId, workspace, cameraPose]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    for (const [id, object] of [...api.objects.entries()]) {
      if (id === "shot-camera") {
        continue;
      }
      api.scene.remove(object);
      api.objects.delete(id);
      api.objectKinds.delete(id);
    }
    worldOverlayMarkerElements(world).forEach((element) => {
      const color =
        element.kind === "actor_mark"
          ? 0xffa657
          : element.kind === "camera_anchor"
            ? 0x79c0ff
            : element.kind === "light_socket"
              ? 0xffd666
              : 0x238636;
      const mesh = new THREE.Mesh(
        element.kind === "zone" ? new THREE.CircleGeometry(0.45, 24) : new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20),
        new THREE.MeshStandardMaterial({ color, emissive: 0x111111 }),
      );
      mesh.name = element.id;
      mesh.position.set(
        element.kind === "actor_mark" ? -0.6 : element.kind === "camera_anchor" ? 1.2 : 0.4,
        0.05,
        element.kind === "light_socket" ? -0.8 : 0.2,
      );
      if (element.kind === "zone") {
        mesh.rotation.x = -Math.PI / 2;
      }
      api.scene.add(mesh);
      api.objects.set(element.id, mesh);
      api.objectKinds.set(element.id, kindFromElement(element));
    });
  }, [world]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    const token = ++loadTokenRef.current;
    if (api.worldRoot) {
      api.scene.remove(api.worldRoot);
      api.worldRoot = null;
    }
    api.stageFloor.visible = true;
    api.grid.visible = true;
    setHud(worldName ?? "No world");
    setShowingImageProxy(previewPlan.kind === "image_proxy");
    if (previewPlan.kind === "unsupported" || !previewPlan.uri) {
      onLoadStateChangeRef.current?.(
        previewPlan.reason?.includes("매니페스트") ? "malformed" : previewPlan.uri ? "unsupported" : world ? "missing_artifact" : "idle",
        previewPlan.reason,
      );
      return;
    }
    onLoadStateChangeRef.current?.("loading");
    const previewUri = previewPlan.uri;
    const attachWorldRoot = (object: THREE.Object3D) => {
      if (!sceneApiRef.current) {
        return;
      }
      sceneApiRef.current.scene.add(object);
      sceneApiRef.current.worldRoot = object;
      sceneApiRef.current.stageFloor.visible = false;
      sceneApiRef.current.grid.visible = false;
    };
    const attachImageProxy = (uri: string, message?: string) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        resolveMediaUri(uri),
        (texture) => {
          if (token !== loadTokenRef.current || !sceneApiRef.current) {
            return;
          }
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(2.4, 1.6),
            new THREE.MeshBasicMaterial({ map: texture }),
          );
          plane.position.y = 0.9;
          attachWorldRoot(plane);
          setShowingImageProxy(true);
          onLoadStateChangeRef.current?.("ready", message);
        },
        undefined,
        () => {
          if (token !== loadTokenRef.current) {
            return;
          }
          setShowingImageProxy(false);
          onLoadStateChangeRef.current?.("missing_artifact", "미리보기 이미지를 불러올 수 없습니다.");
        },
      );
    };
    if (previewPlan.kind === "image_proxy") {
      attachImageProxy(previewUri);
      return () => {
        loadTokenRef.current += 1;
      };
    }

    if (previewPlan.kind === "gaussian_splat" || previewPlan.kind === "point_cloud") {
      void (async () => {
        try {
          const response = await fetch(resolveMediaUri(previewUri));
          if (!response.ok) {
            throw new Error("missing");
          }
          const buffer = await response.arrayBuffer();
          if (token !== loadTokenRef.current || !sceneApiRef.current) {
            return;
          }
          const parsed = parsePly(buffer);
          const object =
            previewPlan.kind === "gaussian_splat"
              ? createGaussianSplatPreview(parsed)
              : createPointCloudPreview(parsed);
          setShowingImageProxy(false);
          attachWorldRoot(object);
          onLoadStateChangeRef.current?.("ready");
        } catch {
          if (token !== loadTokenRef.current) {
            return;
          }
          if (fallbackImageUri) {
            attachImageProxy(
              fallbackImageUri,
              previewPlan.kind === "gaussian_splat"
                ? "Splat artifact missing; showing image proxy."
                : "Point cloud artifact missing; showing image proxy.",
            );
            return;
          }
          onLoadStateChangeRef.current?.(
            "missing_artifact",
            previewPlan.kind === "gaussian_splat"
              ? "Gaussian splat artifact를 찾을 수 없습니다."
              : "Point cloud artifact를 찾을 수 없습니다.",
          );
        }
      })();
      return () => {
        loadTokenRef.current += 1;
      };
    }

    const loader = new GLTFLoader();
    const uri = resolveMediaUri(previewUri);
    loader.load(
      uri,
      (gltf) => {
        if (token !== loadTokenRef.current || !sceneApiRef.current) {
          return;
        }
        setShowingImageProxy(false);
        attachWorldRoot(gltf.scene);
        onLoadStateChangeRef.current?.("ready");
      },
      undefined,
      () => {
        if (token !== loadTokenRef.current || !sceneApiRef.current) {
          return;
        }
        if (fallbackImageUri) {
          attachImageProxy(fallbackImageUri, "Mesh artifact missing; showing image proxy.");
          return;
        }
        setShowingImageProxy(false);
        onLoadStateChangeRef.current?.("missing_artifact", "메시 artifact를 찾을 수 없습니다.");
      },
    );
    return () => {
      loadTokenRef.current += 1;
    };
  }, [previewPlan, worldName, world, fallbackImageUri]);

  useEffect(() => {
    if (!captureSignal || !onCapturePose || !sceneApiRef.current) {
      return;
    }
    const { objects, objectKinds } = sceneApiRef.current;
    const objectTransformsCaptured: StageObjectTransform[] = [];
    objects.forEach((object, id) => {
      const kind = objectKinds.get(id);
      if (!kind || kind === "camera") {
        return;
      }
      objectTransformsCaptured.push({
        id,
        kind,
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      });
    });
    const shot = sceneApiRef.current.shotCamera;
    const source = workspaceRef.current === "record" ? sceneApiRef.current.camera : shot;
    source.updateMatrixWorld(true);
    source.rotation.setFromQuaternion(source.quaternion);
    onCapturePose({
      camera: {
        position: [source.position.x, source.position.y, source.position.z],
        rotation: [source.rotation.x, source.rotation.y, source.rotation.z],
        focalLength: cameraPose?.focalLength ?? 35,
      },
      objects: objectTransformsCaptured,
    });
    liveOverrideRef.current = false;
  }, [captureSignal, onCapturePose, cameraPose?.focalLength]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api || !focusSignal) {
      return;
    }
    if (workspaceRef.current === "record") {
      return;
    }
    const attached = api.transform.object;
    if (!attached) {
      return;
    }
    api.orbit.target.copy(attached.position);
    api.camera.position.set(attached.position.x + 2.2, attached.position.y + 1.4, attached.position.z + 2.2);
  }, [focusSignal]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api || !resetSignal) {
      return;
    }
    if (workspace === "record") {
      liveOverrideRef.current = false;
      if (cameraPose) {
        api.camera.position.set(...cameraPose.position);
        api.camera.rotation.set(...cameraPose.rotation);
        api.shotCamera.position.copy(api.camera.position);
        api.shotCamera.quaternion.copy(api.camera.quaternion);
      }
      return;
    }
    const saved = buildViewRef.current;
    if (saved) {
      api.camera.position.copy(saved.position);
      api.orbit.target.copy(saved.target);
      return;
    }
    api.camera.position.set(2.5, 1.8, 3.2);
    api.orbit.target.set(0, 0.6, 0);
  }, [resetSignal, workspace, cameraPose]);

  useEffect(() => {
    setHud(worldName ?? "No world");
  }, [worldName]);

  return (
    <div className="stage-viewport" ref={containerRef}>
      <div className="viewport-overlay">
        <span className={workspace === "record" ? "rec-badge mode-record" : "mode-build"}>
          {workspace === "record" ? "RECORD" : "BUILD"}
        </span>
        {workspace === "record" && <span className="record-aspect-hud">{outputAspectLabel}</span>}
        <span>{hud}</span>
        <span>{viewportPreviewBadge(previewPlan, showingImageProxy)}</span>
      </div>
    </div>
  );
};

