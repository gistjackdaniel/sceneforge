import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readImportedShotWorld } from "../../application/services/importShotWorld";
import { verticalFovFromLens } from "../../domain/graph/lens";
import { outputAspectRatio, type OutputAspectPreset } from "../../domain/rendering";
import { sampleTimelineMotion } from "../../domain/sceneAuthoring/sampleTimelineMotion";
import type { SomaMotion } from "../../domain/sceneAuthoring/somaMotion";
import { resolveCameraTakeFrames, selectedTake } from "../../domain/shot";
import type { MotionConditionGraph } from "../../domain/shot/motionConditions";
import type { PosedSubject, Shot } from "../../domain/shot/types";
import type { Mat4 } from "../../domain/worlds/coordinates";
import { readGlbRig, type GlbRigRead } from "../../panels/stage/readSkinnedMesh";
import { applyLiveFace, bindFaceRig, type LiveFaceFrame } from "./faceRig";
import { applySomaFrame, bindSomaRig } from "./somaRetarget";

type LoadedActor = {
  body: ReturnType<typeof bindSomaRig>;
  face: ReturnType<typeof bindFaceRig>;
  rest: Array<{ bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion }>;
};

export type ActorSupport = { body: string[]; face: string[] };

const mediaUri = (uri: string) => /^[a-z][a-z0-9+.-]*:|^\//i.test(uri) ? uri : `/${uri}`;

const dispose = (root: THREE.Object3D) => {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.dispose();
  });
  textures.forEach((texture) => texture.dispose());
};

interface ViewportProps {
  shot: Shot;
  frame: number;
  graph?: MotionConditionGraph;
  clips: ReadonlyMap<string, SomaMotion>;
  geometryUri?: string;
  importTransform?: Mat4;
  aspect: OutputAspectPreset;
  liveFace: RefObject<LiveFaceFrame | null>;
  onActorSupport: (support: ActorSupport) => void;
  onRiggedActor: (id: string, rig: GlbRigRead) => void;
  onReady: (ready: boolean) => void;
}

export const ProductionViewport = (props: ViewportProps) => {
  const { shot, geometryUri, importTransform, aspect } = props;
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const meshSignature = JSON.stringify(shot.subjects.map(({ id, representation, uri }) => [id, representation, uri]));
  const transformKey = JSON.stringify(importTransform);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError("");
    latest.current.onReady(false);
    latest.current.onActorSupport({ body: [], face: [] });
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (cause) {
      console.error("WebGL 초기화 실패", cause);
      setError("WebGL을 시작할 수 없습니다.");
      return;
    }
    renderer.setClearColor("#171b1d");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-label", "편집 가능한 3D 샷");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.025, 1000);
    const key = new THREE.DirectionalLight("#fff1d6", 2.1);
    key.position.set(-2.5, 4.5, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.normalBias = 0.025;
    scene.add(key, new THREE.HemisphereLight("#ddefff", "#989079", 2.6));
    if (!geometryUri) scene.add(new THREE.GridHelper(20, 40, "#485155", "#33393c"));
    const loader = new GLTFLoader();
    const actors = new Map<string, LoadedActor>();
    const objects = new Map<string, THREE.Object3D>();
    let alive = true;
    let raf = 0;
    let invalidated = true;

    const load = async (uri: string) => {
      const bytes = await readImportedShotWorld(uri);
      const gltf = bytes ? await loader.parseAsync(bytes, "") : await loader.loadAsync(mediaUri(uri));
      if (alive) return gltf.scene;
      dispose(gltf.scene);
      return undefined;
    };
    const prepareSubject = async (subject: PosedSubject) => {
      const root = subject.representation === "mesh" ? await load(subject.uri) : new THREE.Mesh(
        subject.representation === "sphere" ? new THREE.SphereGeometry(0.25, 24, 12) : new THREE.BoxGeometry(0.4, 0.4, 0.4),
        new THREE.MeshStandardMaterial({ color: "#8f969a" }),
      );
      if (!root) return;
      const group = new THREE.Group();
      group.add(root);
      root.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
      scene.add(group);
      objects.set(subject.id, group);
      if (subject.kind !== "human" || subject.representation !== "mesh") return;
      const body = bindSomaRig(group);
      const rest = body.joints.map(({ bone }) => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
      actors.set(subject.id, { body, rest, face: bindFaceRig(group) });
      const rig = readGlbRig(root);
      if (rig.bones.length) latest.current.onRiggedActor(subject.id, rig);
    };
    const loadRoom = async () => {
      if (!geometryUri) return;
      const room = await load(geometryUri);
      if (!room) return;
      if (importTransform) room.applyMatrix4(new THREE.Matrix4().fromArray(importTransform.flat()).transpose());
      room.traverse((object) => { if (object instanceof THREE.Mesh) object.receiveShadow = true; });
      scene.add(room);
    };
    void Promise.all([loadRoom(), ...shot.subjects.flatMap((item) => item.kind === "light" ? [] : [prepareSubject(item)])]).then(() => {
      if (!alive) return;
      invalidated = true;
      latest.current.onActorSupport({
        body: [...actors].filter(([, actor]) => actor.body.joints.some((joint) => joint.sourceName === "Hips") && actor.body.joints.length > 3).map(([id]) => id),
        face: [...actors].filter(([, actor]) => actor.face.length > 0).map(([id]) => id),
      });
      latest.current.onReady(true);
    }).catch((cause: unknown) => {
      if (!alive) return;
      console.error("3D 자산을 불러오지 못했습니다.", cause);
      setError("3D 자산을 불러오지 못했습니다.");
    });

    const resize = new ResizeObserver(() => {
      const ratio = outputAspectRatio(aspect);
      const width = Math.max(1, Math.min(element.clientWidth, element.clientHeight * ratio));
      const height = Math.max(1, width / ratio);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidated = true;
    });
    resize.observe(element);
    let previous: ViewportProps | undefined;
    let previousFace: LiveFaceFrame | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const state = latest.current;
      const face = state.liveFace.current;
      if (previous === state && previousFace === face && !invalidated) return;
      if (previous !== state || invalidated) {
        const take = selectedTake(state.shot);
        const view = take ? resolveCameraTakeFrames(take, state.shot, { frames: [state.frame] })[0] : undefined;
        if (view) {
          camera.position.fromArray(view.position);
          camera.quaternion.fromArray(view.rotation);
          const lens = state.shot.camera.lens;
          camera.fov = verticalFovFromLens({
            focalLengthMm: view.focalLengthMm ?? lens.focalLengthMm,
            sensorPreset: lens.sensorPreset === "super35" || lens.sensorPreset === "micro-four-thirds" ? lens.sensorPreset : "full-frame",
          });
        } else {
          camera.position.set(2.8, 2.1, 5.1);
          camera.lookAt(0, 0.85, 0);
        }
        camera.updateProjectionMatrix();
        for (const subject of state.shot.subjects) {
          if (subject.kind === "light") continue;
          const object = objects.get(subject.id);
          if (!object) continue;
          const transform = sampleTimelineMotion(state.shot, subject, state.frame, state.graph, state.clips);
          object.visible = subject.visible;
          object.position.fromArray(transform.position);
          object.quaternion.fromArray(transform.rotation);
          object.scale.fromArray(transform.scale);
          object.updateMatrixWorld(true);
          const actor = actors.get(subject.id);
          if (actor && transform.source) applySomaFrame(actor.body, transform.source.motion, transform.source.sample);
          else actor?.rest.forEach(({ bone, position, rotation }) => { bone.position.copy(position); bone.quaternion.copy(rotation); });
        }
        previous = state;
      }
      for (const [id, actor] of actors) applyLiveFace(actor.face, id, face);
      renderer.render(scene, camera);
      previousFace = face;
      invalidated = false;
    };
    draw();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      resize.disconnect();
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [shot.id, meshSignature, geometryUri, transformKey, aspect]);

  return <div className="production-viewport" ref={host}>{error && <p role="alert">{error}</p>}</div>;
};
