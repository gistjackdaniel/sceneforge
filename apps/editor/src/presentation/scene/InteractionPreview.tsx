import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createLoopClock } from "../../application/ports/LoopClock";
import {
  HANDSHAKE_WORLD_IDS,
  PROXY_JOINTS,
  frameAtTime,
  resolveContacts,
  samplePlayback,
  type InteractiveScene,
  type PlaybackFrame,
  type RigPart,
} from "../../domain/sceneAuthoring";

const CONTACT_COLOR: Record<PlaybackFrame["contacts"][number]["kind"], number> = {
  hand_hand: 0xffd166,
  hand_object: 0x6ee7ff,
  object_surface: 0xb6f5b6,
};

const PART_LABEL: Partial<Record<RigPart, string>> = {
  left_hand: "왼손",
  right_hand: "오른손",
};

interface InteractionPreviewProps {
  scene: InteractiveScene;
  onEditHand: (rigPart: "left_hand" | "right_hand") => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Presentation-only player. Reads a sampled playback frame and does not write scene state.
 */
export const InteractionPreview = ({ scene, onEditHand, onUndo, onRedo }: InteractionPreviewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<PlaybackFrame>(samplePlayback(scene, 0));
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const playback = samplePlayback(scene, frame);
  playbackRef.current = playback;

  useEffect(() => {
    if (!playing) return;
    const clock = createLoopClock({
      duration: Math.max(0.001, scene.frameCount / scene.fps),
      fps: scene.fps,
      autoplay: true,
      loop: true,
    });
    const unsubscribe = clock.subscribe((time) => {
      setFrame(frameAtTime(time, scene.fps, scene.frameCount));
    });
    return () => {
      unsubscribe();
      clock.stop();
    };
  }, [playing, scene.fps, scene.frameCount]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x121614, 1);
    host.appendChild(renderer.domElement);
    const view = new THREE.Scene();
    view.add(new THREE.HemisphereLight(0xf4f7f2, 0x2a2620, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2.5, 4, 2);
    view.add(key);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x1c2420, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    view.add(floor);
    view.add(new THREE.GridHelper(6, 12, 0x31403a, 0x24302b));
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3833, roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.4, 0.08), wallMaterial);
    backWall.position.set(0, 1.2, 1.8);
    view.add(backWall);

    const actorGroups = new Map<string, { joints: Map<string, THREE.Object3D>; line: THREE.LineSegments }>();
    for (const subject of scene.subjects.filter((item) => item.kind === "actor")) {
      const joints = new Map<string, THREE.Object3D>();
      const positions = new Float32Array(PROXY_JOINTS.length * 2 * 3);
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3)),
        new THREE.LineBasicMaterial({ color: subject.color }),
      );
      view.add(line);
      for (const joint of PROXY_JOINTS) {
        const radius = joint.name.endsWith("wrist") ? 0.055 : joint.name === "head" ? 0.09 : 0.04;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 16, 12),
          new THREE.MeshStandardMaterial({ color: subject.color, roughness: 0.45 }),
        );
        joints.set(joint.name, mesh);
        view.add(mesh);
      }
      actorGroups.set(subject.instanceId, { joints, line });
    }

    const objectMeshes = new Map<string, THREE.Mesh>();
    for (const object of scene.objects) {
      const subject = scene.subjects.find((item) => item.instanceId === object.instanceId);
      const color = subject?.color ?? "#dddddd";
      const mesh = new THREE.Mesh(
        object.role === "set_piece" ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(0.5, 0.42, 1, 24),
        new THREE.MeshStandardMaterial({
          color,
          roughness: object.role === "prop" ? 0.28 : 0.72,
          emissive: color,
          emissiveIntensity: object.role === "prop" ? 0.45 : 0,
        }),
      );
      mesh.scale.set(object.rest.scale[0], object.rest.scale[1], object.rest.scale[2]);
      objectMeshes.set(object.instanceId, mesh);
      view.add(mesh);
    }

    const markers = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 18, 12),
        new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.35 }),
      );
      mesh.visible = false;
      view.add(mesh);
      return mesh;
    });
    const attachmentPositions = new Float32Array(6);
    const attachment = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(attachmentPositions, 3)),
      new THREE.LineBasicMaterial({ color: 0xf3e2b8 }),
    );
    view.add(attachment);

    const pathPoints = scene.camera.samples.map((sample) => new THREE.Vector3(...sample.position));
    if (pathPoints.length > 1) {
      view.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPoints), new THREE.LineBasicMaterial({ color: 0x79c0ff })));
    }
    const shotCamera = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x79c0ff }),
    );
    view.add(shotCamera);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    camera.position.set(0.15, 1.75, -2.85);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.2, 0.95, 0.12);
    controls.enableDamping = true;

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let raf = 0;
    const draw = () => {
      const frameState = playbackRef.current;
      for (const actor of frameState.actors) {
        const group = actorGroups.get(actor.instanceId);
        if (!group) continue;
        const positions = group.line.geometry.getAttribute("position");
        let cursor = 0;
        for (const joint of actor.joints) {
          const mesh = group.joints.get(joint.name);
          mesh?.position.set(joint.position[0], joint.position[1], joint.position[2]);
          if (!joint.parent) continue;
          const parent = actor.joints.find((item) => item.name === joint.parent);
          if (!parent || !(positions instanceof THREE.BufferAttribute)) continue;
          positions.setXYZ(cursor, parent.position[0], parent.position[1], parent.position[2]);
          positions.setXYZ(cursor + 1, joint.position[0], joint.position[1], joint.position[2]);
          cursor += 2;
        }
        if (positions instanceof THREE.BufferAttribute) positions.needsUpdate = true;
      }
      for (const object of frameState.objects) {
        const mesh = objectMeshes.get(object.instanceId);
        if (!mesh) continue;
        mesh.position.set(object.position[0], object.position[1], object.position[2]);
        mesh.quaternion.set(object.rotation[0], object.rotation[1], object.rotation[2], object.rotation[3]);
      }
      markers.forEach((marker, index) => {
        const contact = frameState.contacts[index];
        marker.visible = Boolean(contact);
        if (!contact) return;
        const lift: [number, number, number] =
          contact.kind === "object_surface" ? [0.22, 0.16, 0] : contact.kind === "hand_object" ? [0, 0.18, -0.08] : [0, 0.16, 0];
        marker.position.set(
          contact.position[0] + lift[0],
          contact.position[1] + lift[1],
          contact.position[2] + lift[2],
        );
        const material = marker.material;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.setHex(CONTACT_COLOR[contact.kind]);
          material.emissive.setHex(CONTACT_COLOR[contact.kind]);
        }
      });
      const cup = frameState.objects.find((object) => object.worldAssetId === HANDSHAKE_WORLD_IDS.cup);
      const wristName = cup?.parentRigPart === "left_hand" ? "left_wrist" : cup?.parentRigPart === "right_hand" ? "right_wrist" : undefined;
      const parentPoint = wristName
        ? frameState.actors.find((actor) => actor.instanceId === cup?.parentInstanceId)?.joints.find((joint) => joint.name === wristName)
        : frameState.objects.find((object) => object.instanceId === cup?.parentInstanceId);
      attachment.visible = Boolean(cup && parentPoint);
      if (cup && parentPoint) {
        const attribute = attachment.geometry.getAttribute("position");
        if (attribute instanceof THREE.BufferAttribute) {
          attribute.setXYZ(0, cup.position[0], cup.position[1], cup.position[2]);
          attribute.setXYZ(1, parentPoint.position[0], parentPoint.position[1], parentPoint.position[2]);
          attribute.needsUpdate = true;
        }
      }
      shotCamera.position.set(frameState.camera.position[0], frameState.camera.position[1], frameState.camera.position[2]);
      shotCamera.quaternion.set(
        frameState.camera.rotation[0],
        frameState.camera.rotation[1],
        frameState.camera.rotation[2],
        frameState.camera.rotation[3],
      );
      controls.update();
      renderer.render(view, camera);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      view.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.domElement.remove();
    };
  }, [scene.subjects, scene.objects, scene.camera.samples]);

  const actorB = scene.subjects.find((subject) => subject.worldAssetId === HANDSHAKE_WORLD_IDS.actorB);
  const handshake = resolveContacts(scene).find((contact) => contact.contactId === "handshake_01");
  const bPart =
    actorB && handshake?.b.instanceId === actorB.instanceId
      ? handshake.b.rigPart
      : actorB && handshake?.a.instanceId === actorB.instanceId
        ? handshake.a.rigPart
        : undefined;
  const nextPart = bPart === "right_hand" ? "left_hand" : "right_hand";
  const cup = playback.objects.find((object) => object.worldAssetId === HANDSHAKE_WORLD_IDS.cup);
  const cupParent = cup?.parentRigPart ? PART_LABEL[cup.parentRigPart] ?? cup.parentRigPart : cup?.parentInstanceId ? "테이블" : "없음";

  return (
    <div className="interaction-preview">
      <div className="interaction-stage" ref={hostRef} />
      <div className="interaction-legend">
        <strong>A가 B에게 다가가 악수하고, B가 컵을 내려놓는다</strong>
        <span>{playback.frame}f · {(playback.timeSeconds).toFixed(2)}s</span>
        <span>컵 · {cupParent}</span>
        <span>B 악수 · {bPart === "right_hand" ? "오른손" : "왼손"}</span>
        {playback.contacts.map((contact) => (
          <span key={contact.contactId} className={`interaction-contact is-${contact.kind}`}>
            {contact.kind === "hand_hand" ? "손-손" : contact.kind === "hand_object" ? "손-컵" : "컵-테이블"}
          </span>
        ))}
      </div>
      <div className="interaction-transport">
        <button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>
          {playing ? "일시정지" : "재생"}
        </button>
        <input
          aria-label="상호작용 프레임"
          type="range"
          min={0}
          max={scene.frameCount - 1}
          value={frame}
          onChange={(event) => {
            setPlaying(false);
            setFrame(event.target.valueAsNumber);
          }}
        />
        <button type="button" onClick={() => onEditHand(nextPart)}>
          {nextPart === "right_hand" ? "B를 오른손으로" : "B를 왼손으로"}
        </button>
        <button type="button" onClick={onUndo}>실행 취소</button>
        <button type="button" onClick={onRedo}>다시 실행</button>
      </div>
    </div>
  );
};
