import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Project } from "../../domain/project/types";
import {
  HANDSHAKE_SHOT_ID,
  HANDSHAKE_WORLD_IDS,
  SUBJECT_IDS,
  createHandshakePoseSource,
  resolveContacts,
  samplePlayback,
  type InteractionPreviewRecord,
  type RigPart,
} from "../../domain/sceneAuthoring";
import type { SampledActor } from "../../domain/sceneAuthoring/playback";
import type { Shot } from "../../domain/shot/types";
import { SMPLX_PART_JOINT } from "../../domain/worlds/sceneState";
import { solveTwoBone, type Vec3 } from "./twoBoneIk";

const CONTACT_COLOR: Record<string, string> = {
  hand_hand: "#ffd166",
  hand_object: "#6ee7ff",
  object_surface: "#b6f5b6",
};

const ACTOR_MESH: Record<string, string> = {
  [SUBJECT_IDS.actorA]: "/meshes/phase0/actor-a.glb",
  [SUBJECT_IDS.actorB]: "/meshes/phase0/actor-b.glb",
};

const ROOM_MESH = "/worlds/apartment_livingroom/preview.glb";
const PROXY_ARM_REACH = 0.27 + 0.25;

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _child = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();
const _worldQuat = new THREE.Quaternion();
const _shoulder = new THREE.Vector3();
const _point = new THREE.Vector3();

type Bind = { q: THREE.Quaternion; p: THREE.Vector3; s: THREE.Vector3 };

type Arm = {
  upper: THREE.Bone;
  lower: THREE.Bone;
  fist: THREE.Bone;
  upperLen: number;
  lowerLen: number;
};

type ActorRig = {
  subjectId: string;
  root: THREE.Object3D;
  hips: THREE.Bone;
  footL?: THREE.Bone;
  footR?: THREE.Bone;
  left?: Arm;
  right?: Arm;
  bind: Map<THREE.Bone, Bind>;
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
};

const mediaUri = (uri: string): string => (
  uri.startsWith("/") || uri.startsWith("http") || uri.startsWith("data:") || uri.startsWith("blob:") ? uri : `/${uri}`
);

const boneMap = (root: THREE.Object3D): Map<string, THREE.Bone> => {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((child) => {
    const bone = child as THREE.Bone;
    if (bone.isBone && bone.name) bones.set(bone.name, bone);
  });
  return bones;
};

const boneNamed = (bones: Map<string, THREE.Bone>, ...names: string[]): THREE.Bone | undefined => {
  for (const name of names) {
    const bone = bones.get(name);
    if (bone) return bone;
  }
  return undefined;
};

const armFrom = (bones: Map<string, THREE.Bone>, side: "L" | "R"): Arm | undefined => {
  const upper = boneNamed(bones, `UpperArm.${side}`, `UpperArm${side}`);
  const lower = boneNamed(bones, `LowerArm.${side}`, `LowerArm${side}`);
  const fist = boneNamed(bones, `Fist.${side}`, `Fist${side}`);
  if (!upper || !lower || !fist) return undefined;
  return { upper, lower, fist, upperLen: 0, lowerLen: 0 };
};

const captureBind = (root: THREE.Object3D): Map<THREE.Bone, Bind> => {
  const bind = new Map<THREE.Bone, Bind>();
  root.traverse((child) => {
    const bone = child as THREE.Bone;
    if (!bone.isBone) return;
    bind.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone(), s: bone.scale.clone() });
  });
  return bind;
};

const boneDistance = (from: THREE.Object3D, to: THREE.Object3D): number => {
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  return from.getWorldPosition(start).distanceTo(to.getWorldPosition(end));
};

const aimBone = (bone: THREE.Bone, child: THREE.Bone, targetWorld: THREE.Vector3) => {
  bone.updateWorldMatrix(true, false);
  bone.getWorldPosition(_origin);
  child.getWorldPosition(_child);
  _from.subVectors(_child, _origin);
  _to.subVectors(targetWorld, _origin);
  if (_from.lengthSq() < 1e-10 || _to.lengthSq() < 1e-10) return;
  _from.normalize();
  _to.normalize();
  if (_from.dot(_to) > 0.999999) return;
  _quat.setFromUnitVectors(_from, _to);
  bone.getWorldQuaternion(_worldQuat);
  _worldQuat.premultiply(_quat);
  const parent = bone.parent;
  if (!parent) {
    bone.quaternion.copy(_worldQuat);
  } else {
    parent.getWorldQuaternion(_parentQuat);
    bone.quaternion.copy(_parentQuat.invert().multiply(_worldQuat));
  }
  bone.updateWorldMatrix(true, true);
};

const restoreBind = (rig: ActorRig) => {
  for (const [bone, bind] of rig.bind) {
    bone.quaternion.copy(bind.q);
    bone.position.copy(bind.p);
    bone.scale.copy(bind.s);
  }
};

const jointAt = (actor: SampledActor, name: string): Vec3 | undefined => {
  const joint = actor.joints.find((item) => item.name === name);
  return joint?.position;
};

const reachArm = (arm: Arm, wrist: Vec3 | undefined, elbowHint: Vec3 | undefined) => {
  if (!wrist || !(arm.upperLen > 0) || !(arm.lowerLen > 0)) return;
  arm.upper.updateWorldMatrix(true, false);
  arm.upper.getWorldPosition(_shoulder);
  const localTarget: Vec3 = [wrist[0] - _shoulder.x, wrist[1] - _shoulder.y, wrist[2] - _shoulder.z];
  const pole: Vec3 | undefined = elbowHint
    ? [elbowHint[0] - _shoulder.x, elbowHint[1] - _shoulder.y, elbowHint[2] - _shoulder.z]
    : undefined;
  const solved = solveTwoBone(arm.upperLen, arm.lowerLen, localTarget, pole);
  const elbowWorld = _shoulder.clone().add(new THREE.Vector3(...solved.elbow));
  const wristWorld = _shoulder.clone().add(new THREE.Vector3(...solved.wrist));
  aimBone(arm.upper, arm.lower, elbowWorld);
  aimBone(arm.lower, arm.fist, wristWorld);
};

const poseActor = (rig: ActorRig, actor: SampledActor) => {
  const pelvis = actor.joints.find((joint) => joint.name === SMPLX_PART_JOINT.pelvis);
  if (!pelvis) return;
  restoreBind(rig);
  rig.root.quaternion.set(pelvis.rotation[0], pelvis.rotation[1], pelvis.rotation[2], pelvis.rotation[3]);
  rig.root.position.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);
  rig.hips.getWorldPosition(_point);
  rig.root.position.set(pelvis.position[0] - _point.x, pelvis.position[1] - _point.y, pelvis.position[2] - _point.z);
  rig.root.updateMatrixWorld(true);
  if (rig.left) reachArm(rig.left, jointAt(actor, SMPLX_PART_JOINT.left_hand), jointAt(actor, "left_elbow"));
  if (rig.right) reachArm(rig.right, jointAt(actor, SMPLX_PART_JOINT.right_hand), jointAt(actor, "right_elbow"));
  rig.root.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
  });
};

const fitRoom = (room: THREE.Object3D, rigs: readonly ActorRig[]) => {
  const feet: number[] = [];
  const hips: THREE.Vector3[] = [];
  for (const rig of rigs) {
    hips.push(rig.hips.getWorldPosition(new THREE.Vector3()));
    for (const foot of [rig.footL, rig.footR]) {
      if (!foot) continue;
      feet.push(foot.getWorldPosition(new THREE.Vector3()).y);
    }
  }
  if (feet.length === 0 || hips.length === 0) return false;
  const box = new THREE.Box3().setFromObject(room);
  if (box.isEmpty()) return false;
  const midX = hips.reduce((sum, item) => sum + item.x, 0) / hips.length;
  const midZ = hips.reduce((sum, item) => sum + item.z, 0) / hips.length;
  room.position.x += midX - (box.min.x + box.max.x) / 2;
  room.position.z += midZ - 0.55 - box.min.z;
  room.position.y += Math.min(...feet) - box.min.y;
  room.updateMatrixWorld(true);
  return true;
};

const showRoomInterior = (room: THREE.Object3D) => {
  room.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material) material.side = THREE.DoubleSide;
    }
  });
};

const frameInsideRoom = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  room: THREE.Object3D,
  rigs: readonly ActorRig[],
) => {
  const hips = rigs.map((rig) => rig.hips.getWorldPosition(new THREE.Vector3()));
  if (hips.length === 0) return;
  const midX = hips.reduce((sum, item) => sum + item.x, 0) / hips.length;
  const midY = hips.reduce((sum, item) => sum + item.y, 0) / hips.length;
  const midZ = hips.reduce((sum, item) => sum + item.z, 0) / hips.length;
  const roomBox = new THREE.Box3().setFromObject(room);
  camera.position.set(midX, midY + 0.15, Math.min(roomBox.max.z - 0.35, midZ + 2.6));
  controls.target.set(midX, midY - 0.15, midZ);
  controls.update();
};

const scaleRigs = (rigs: readonly ActorRig[]) => {
  const source = rigs.find((rig) => rig.left || rig.right);
  const sourceArm = source?.left ?? source?.right;
  if (!source || !sourceArm) return;
  source.root.scale.set(1, 1, 1);
  source.root.updateMatrixWorld(true);
  const span = boneDistance(sourceArm.upper, sourceArm.fist);
  if (!(span > 1e-4)) return;
  const scale = PROXY_ARM_REACH / span;
  for (const rig of rigs) {
    rig.root.scale.setScalar(scale);
    rig.root.updateMatrixWorld(true);
    for (const arm of [rig.left, rig.right]) {
      if (!arm) continue;
      arm.upperLen = boneDistance(arm.upper, arm.lower);
      arm.lowerLen = boneDistance(arm.lower, arm.fist);
    }
  }
};

const paintMarkers = (
  group: THREE.Group,
  shot: Shot,
  preview: InteractionPreviewRecord,
  frame: number,
) => {
  while (group.children.length > 0) {
    const child = group.children[0];
    if (!child) break;
    group.remove(child);
    disposeObject(child);
  }
  const contacts = resolveContacts(preview);
  const poses = createHandshakePoseSource(shot, contacts);
  const sample = samplePlayback(shot, preview, frame, poses);
  for (const object of sample.objects) {
    const mesh = object.label === "컵"
      ? new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({ color: object.color }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: object.color }));
    mesh.position.set(object.position[0], object.position[1], object.position[2]);
    group.add(mesh);
    if (!object.parentSubjectId) continue;
    const parentActor = sample.actors.find((actor) => actor.subjectId === object.parentSubjectId);
    const wristName = object.parentRigPart ? SMPLX_PART_JOINT[object.parentRigPart] : undefined;
    const parentJoint = wristName ? parentActor?.joints.find((joint) => joint.name === wristName) : undefined;
    const parentObject = sample.objects.find((item) => item.subjectId === object.parentSubjectId);
    const parentPosition = parentJoint?.position ?? parentObject?.position;
    if (!parentPosition) continue;
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...parentPosition),
        new THREE.Vector3(...object.position),
      ]),
      new THREE.LineBasicMaterial({ color: "#9ad7c4" }),
    ));
  }
  for (const contact of sample.contacts) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      new THREE.MeshStandardMaterial({ color: CONTACT_COLOR[contact.kind] ?? "#ffffff", emissive: CONTACT_COLOR[contact.kind] ?? "#ffffff", emissiveIntensity: 0.35 }),
    );
    marker.position.set(contact.position[0], contact.position[1], contact.position[2]);
    group.add(marker);
  }
  return sample;
};

export const InteractionPreview = ({
  project,
  onClose,
  onChangeHand,
}: {
  project: Project;
  onClose: () => void;
  onChangeHand: (rigPart: Extract<RigPart, "left_hand" | "right_hand">) => void;
}) => {
  const shot = project.shots?.[HANDSHAKE_SHOT_ID];
  const preview = project.interactionPreviews?.[HANDSHAKE_SHOT_ID];
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(72);
  const shotRef = useRef(shot);
  const previewRef = useRef(preview);
  const projectRef = useRef(project);
  const paintRef = useRef<() => void>(() => undefined);
  const [frame, setFrame] = useState(72);
  const [playing, setPlaying] = useState(false);
  shotRef.current = shot;
  previewRef.current = preview;
  projectRef.current = project;
  frameRef.current = frame;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#101614");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    camera.position.set(1.5, 1.8, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(1.5, 1.1, -0.1);
    controls.update();
    scene.add(new THREE.AmbientLight("#ffffff", 0.85));
    const key = new THREE.DirectionalLight("#fff4e5", 1.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    scene.add(new THREE.GridHelper(6, 12, "#2c3a34", "#1c2622"));
    const markers = new THREE.Group();
    scene.add(markers);
    const rigs: ActorRig[] = [];
    let room: THREE.Object3D | undefined;
    let roomFit = false;
    const loader = new GLTFLoader();
    const setWorld = projectRef.current.worlds[previewRef.current?.worldAssetId ?? HANDSHAKE_WORLD_IDS.set];
    const roomUri = mediaUri(setWorld?.surfaceMeshPath || setWorld?.previewPath || ROOM_MESH);

    const draw = () => {
      const currentShot = shotRef.current;
      const currentPreview = previewRef.current;
      if (!currentShot || !currentPreview) return;
      const sample = paintMarkers(markers, currentShot, currentPreview, frameRef.current);
      for (const rig of rigs) {
        const actor = sample.actors.find((item) => item.subjectId === rig.subjectId);
        if (actor) poseActor(rig, actor);
      }
      if (!roomFit && room && rigs.length > 0) roomFit = fitRoom(room, rigs);
      controls.update();
      renderer.render(scene, camera);
    };
    paintRef.current = draw;

    const loadActor = async (subjectId: string, uri: string) => {
      const gltf = await loader.loadAsync(mediaUri(uri));
      if (cancelled) {
        disposeObject(gltf.scene);
        return;
      }
      const bones = boneMap(gltf.scene);
      const hips = bones.get("Hips");
      if (!hips) {
        disposeObject(gltf.scene);
        console.error("상호작용 프리뷰에서 골반 본을 찾지 못했습니다.");
        return;
      }
      scene.add(gltf.scene);
      rigs.push({
        subjectId,
        root: gltf.scene,
        hips,
        footL: boneNamed(bones, "Foot.L", "FootL"),
        footR: boneNamed(bones, "Foot.R", "FootR"),
        left: armFrom(bones, "L"),
        right: armFrom(bones, "R"),
        bind: captureBind(gltf.scene),
      });
    };

    const actorUri = (subjectId: string): string => {
      const subject = shotRef.current?.subjects.find((item) => item.id === subjectId);
      if (subject && subject.kind !== "light" && subject.uri.endsWith(".glb")) return subject.uri;
      return ACTOR_MESH[subjectId] ?? "";
    };

    void Promise.all([
      loadActor(SUBJECT_IDS.actorA, actorUri(SUBJECT_IDS.actorA)),
      loadActor(SUBJECT_IDS.actorB, actorUri(SUBJECT_IDS.actorB)),
      loader.loadAsync(roomUri).then((gltf) => {
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        room = gltf.scene;
        showRoomInterior(room);
        scene.add(room);
      }),
    ]).then(() => {
      if (cancelled) return;
      scaleRigs(rigs);
      draw();
      if (room && rigs.length > 0) frameInsideRoom(camera, controls, room, rigs);
      renderer.render(scene, camera);
    }).catch((error: unknown) => {
      console.error("상호작용 프리뷰 메시를 불러오지 못했습니다.", error);
    });

    host.appendChild(renderer.domElement);
    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    draw();
    const observer = new ResizeObserver(() => {
      resize();
      renderer.render(scene, camera);
    });
    observer.observe(host);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    paintRef.current();
  }, [frame, shot, preview]);

  useEffect(() => {
    if (!playing || !shot) return;
    const last = Math.max(0, shot.time.durationFrames - 1);
    const timer = window.setInterval(() => {
      setFrame((current) => (current >= last ? 0 : current + 1));
    }, 1000 / shot.time.fps);
    return () => window.clearInterval(timer);
  }, [playing, shot]);

  const handshake = preview ? resolveContacts(preview).find((contact) => contact.contactId === "handshake_01") : undefined;
  const hand = handshake?.b.rigPart;
  const lastFrame = Math.max(0, (shot?.time.durationFrames ?? 1) - 1);

  return (
    <div className="interaction-preview" role="region" aria-label="상호작용 프리뷰">
      <div className="interaction-hud">
        <p>A가 왼손으로 컵을 들고, 48프레임부터 테이블에 놓습니다. 악수는 B의 오른손이 기본입니다.</p>
        <div className="interaction-hands" role="group" aria-label="B의 악수 손">
          <button type="button" aria-pressed={hand === "left_hand"} onClick={() => onChangeHand("left_hand")}>B 왼손</button>
          <button type="button" aria-pressed={hand === "right_hand"} onClick={() => onChangeHand("right_hand")}>B 오른손</button>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
        <label className="interaction-frame">
          <span>{frame}f</span>
          <input
            type="range"
            min={0}
            max={lastFrame}
            value={Math.min(frame, lastFrame)}
            aria-label="프레임"
            onChange={(event) => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }}
          />
          <button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "일시정지" : "재생"}</button>
        </label>
        <ul className="interaction-legend">
          <li><i style={{ background: CONTACT_COLOR.hand_hand }} />손-손</li>
          <li><i style={{ background: CONTACT_COLOR.hand_object }} />손-컵</li>
          <li><i style={{ background: CONTACT_COLOR.object_surface }} />컵-테이블</li>
        </ul>
      </div>
      <div ref={hostRef} className="interaction-stage" />
    </div>
  );
};
