import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Project } from "../../domain/project/types";
import {
  HANDSHAKE_SHOT_ID,
  createHandshakePoseSource,
  resolveContacts,
  samplePlayback,
  type InteractionPreviewRecord,
  type RigPart,
} from "../../domain/sceneAuthoring";
import type { Shot } from "../../domain/shot/types";

const CONTACT_COLOR: Record<string, string> = {
  hand_hand: "#ffd166",
  hand_object: "#6ee7ff",
  object_surface: "#b6f5b6",
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

const paint = (
  group: THREE.Group,
  shot: Shot,
  preview: InteractionPreviewRecord,
  frame: number,
) => {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
  const contacts = resolveContacts(preview);
  const poses = createHandshakePoseSource(shot, contacts);
  const sample = samplePlayback(shot, preview, frame, poses);
  for (const actor of sample.actors) {
    const color = new THREE.Color(actor.color);
    for (const joint of actor.joints) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 12, 8),
        new THREE.MeshStandardMaterial({ color: actor.color, roughness: 0.6 }),
      );
      marker.position.set(joint.position[0], joint.position[1], joint.position[2]);
      group.add(marker);
      if (!joint.parent) continue;
      const parent = actor.joints.find((item) => item.name === joint.parent);
      if (!parent) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...parent.position),
          new THREE.Vector3(...joint.position),
        ]),
        new THREE.LineBasicMaterial({ color }),
      );
      group.add(line);
    }
  }
  for (const object of sample.objects) {
    const mesh = object.label === "컵"
      ? new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({ color: object.color }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: object.color }));
    mesh.position.set(object.position[0], object.position[1], object.position[2]);
    group.add(mesh);
    if (!object.parentSubjectId) continue;
    const parentActor = sample.actors.find((actor) => actor.subjectId === object.parentSubjectId);
    const wristName = object.parentRigPart === "left_hand" ? "left_wrist" : object.parentRigPart === "right_hand" ? "right_wrist" : undefined;
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
  const paintRef = useRef<() => void>(() => undefined);
  const [frame, setFrame] = useState(72);
  const [playing, setPlaying] = useState(false);
  shotRef.current = shot;
  previewRef.current = preview;
  frameRef.current = frame;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#101614");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    camera.position.set(1.5, 1.8, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(1.5, 1.1, -0.1);
    controls.update();
    scene.add(new THREE.AmbientLight("#ffffff", 0.7));
    const key = new THREE.DirectionalLight("#fff4e5", 1.1);
    key.position.set(2, 4, 3);
    scene.add(key);
    scene.add(new THREE.GridHelper(6, 12, "#2c3a34", "#1c2622"));
    const group = new THREE.Group();
    scene.add(group);
    host.appendChild(renderer.domElement);
    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const draw = () => {
      const currentShot = shotRef.current;
      const currentPreview = previewRef.current;
      if (currentShot && currentPreview) paint(group, currentShot, currentPreview, frameRef.current);
      controls.update();
      renderer.render(scene, camera);
    };
    paintRef.current = draw;
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
