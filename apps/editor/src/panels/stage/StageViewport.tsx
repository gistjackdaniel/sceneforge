import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

interface StageViewportProps {
  worldName?: string;
  previewPath?: string;
  showOverlay?: boolean;
  cameraPose?: StageCameraPose;
  onCapturePose?: (payload: {
    camera: StageCameraPose;
    objects: StageObjectTransform[];
  }) => void;
  onTransformChange?: (objectId: string, transform: StageObjectTransform) => void;
  captureSignal?: number;
}

export const StageViewport = ({
  worldName,
  previewPath,
  showOverlay = true,
  cameraPose,
  onCapturePose,
  onTransformChange,
  captureSignal = 0,
}: StageViewportProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneApiRef = useRef<{
    camera: THREE.PerspectiveCamera;
    objects: Map<string, THREE.Object3D>;
    objectKinds: Map<string, "actor" | "prop" | "light">;
  } | null>(null);

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

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x7ee8ff, 1.2);
    keyLight.position.set(3, 5, 2);
    keyLight.name = "key-light";
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0xff8c5a, 0.6, 12);
    fillLight.position.set(-2, 2.5, 1);
    fillLight.name = "fill-light";
    scene.add(fillLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x151b24 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const grid = new THREE.GridHelper(12, 24, 0x00c2ff, 0x1e2a38);
    scene.add(grid);

    const actorMark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.03, 24),
      new THREE.MeshStandardMaterial({ color: 0xffa657, emissive: 0x331800 }),
    );
    actorMark.position.set(-0.6, 0.05, 0.2);
    actorMark.name = "actor-mark";
    scene.add(actorMark);

    const propMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x238636 }),
    );
    propMesh.position.set(0.4, 0.25, -0.3);
    propMesh.name = "hero-prop";
    scene.add(propMesh);

    const objects = new Map<string, THREE.Object3D>([
      ["actor-mark", actorMark],
      ["hero-prop", propMesh],
      ["key-light", keyLight],
      ["fill-light", fillLight],
    ]);
    const objectKinds = new Map<string, "actor" | "prop" | "light">([
      ["actor-mark", "actor"],
      ["hero-prop", "prop"],
      ["key-light", "light"],
      ["fill-light", "light"],
    ]);

    sceneApiRef.current = { camera, objects, objectKinds };

    const loader = new GLTFLoader();
    if (previewPath) {
      loader.load(
        `/${previewPath}`,
        (gltf) => {
          gltf.scene.position.set(0, 0, 0);
          gltf.scene.scale.setScalar(1);
          scene.add(gltf.scene);
        },
        undefined,
        () => {
          const placeholder = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.08, 1.2),
            new THREE.MeshStandardMaterial({ color: 0x1f6feb }),
          );
          placeholder.position.y = 0.04;
          scene.add(placeholder);
        },
      );
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const pickObject = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const pickables = Array.from(objects.values());
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits[0]?.object) {
        transform.attach(hits[0].object);
      }
    };

    const handleTransformChange = () => {
      const attached = transform.object;
      if (!attached || !onTransformChange) {
        return;
      }
      const id = attached.name;
      const kind = objectKinds.get(id);
      if (!kind) {
        return;
      }
      onTransformChange(id, {
        id,
        kind,
        position: [attached.position.x, attached.position.y, attached.position.z],
        rotation: [attached.rotation.x, attached.rotation.y, attached.rotation.z],
      });
    };

    transform.addEventListener("change", handleTransformChange);
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
    });
    renderer.domElement.addEventListener("pointerdown", pickObject);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight || 320;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", pickObject);
      transform.removeEventListener("change", handleTransformChange);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneApiRef.current = null;
    };
  }, [onTransformChange, previewPath, worldName]);

  useEffect(() => {
    if (!captureSignal || !onCapturePose || !sceneApiRef.current) {
      return;
    }
    const { camera, objects, objectKinds } = sceneApiRef.current;
    const objectTransforms: StageObjectTransform[] = [];
    objects.forEach((object, id) => {
      const kind = objectKinds.get(id);
      if (!kind) {
        return;
      }
      objectTransforms.push({
        id,
        kind,
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      });
    });
    onCapturePose({
      camera: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
        focalLength: 35,
      },
      objects: objectTransforms,
    });
  }, [captureSignal, onCapturePose]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) {
      return;
    }
    api.objects.forEach((object) => {
      object.visible = showOverlay;
    });
  }, [showOverlay]);

  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api || !cameraPose) {
      return;
    }
    api.camera.position.set(...cameraPose.position);
    api.camera.rotation.set(...cameraPose.rotation);
    api.camera.updateProjectionMatrix();
  }, [cameraPose]);

  return (
    <div className="stage-viewport" ref={containerRef}>
      <div className="viewport-overlay">
        <span className="rec-badge">● REC</span>
        <span>{worldName ?? "No world linked"}</span>
        <span>{previewPath ? `preview: ${previewPath}` : "3D preview"}</span>
      </div>
    </div>
  );
};
