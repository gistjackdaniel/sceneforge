import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "../../application/commands/bus";
import { applyCommand } from "../../application/commands/apply";
import { deserializeProject, serializeProject } from "../../infrastructure/persistence";
import { shotId, subjectId } from "../shot";
import { phase0Scene } from "../shot/phase0Sample";
import { createPersistentIdFactory, newIdSchema } from "../worlds/ids";
import { importRiggedActor } from "../worlds/riggedActorImport";
import { createMeshExampleWorld } from "../worlds/sampleWorlds";
import type { Project } from "../project/types";
import type { Shot } from "../shot/types";
import {
  ACTOR_A_ROOT,
  FIXTURE_DURATION_FRAMES,
  FIXTURE_FPS,
  HANDSHAKE_SHOT_ID,
  HANDSHAKE_TAKE_ID,
  SUBJECT_IDS,
  changeContactEffector,
  createHandshakePoseSource,
  createHandshakePreviewRecord,
  createHandshakeShot,
  installInteractionScene,
  previewStateEqual,
  projectPreviewState,
  resolveContacts,
} from "./index";

const NOW = "2026-11-12T00:00:00.000Z";

const emptyProject = (): Project => ({
  id: "p",
  name: "P",
  createdAt: NOW,
  updatedAt: NOW,
  metrics: { editLatencyMs: 0, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
  activeSequenceId: "s",
  sequences: {},
  clips: {},
  clipGraphs: {},
  nodes: {},
  references: {},
  dependencyMap: { downstreamByNodeId: {}, clipsByNodeId: {}, referencesByNodeId: {}, cacheHashesByClipId: {} },
  worlds: { "world-apartment-livingroom": createMeshExampleWorld() },
  assets: {},
  caches: {},
  connectors: {},
  libraryNodeIds: [],
});

const install = (project: Project) => installInteractionScene(project).project;

const hash = (shot: Shot, preview: NonNullable<Project["interactionPreviews"]>[string], selector: Parameters<typeof projectPreviewState>[2]) =>
  projectPreviewState(shot, preview, selector);

describe("Phase 1 contact effector", () => {
  it("B의 악수 손을 왼손으로 바꿔도 카메라, 배경, A의 루트는 남고 언두가 오른손을 되돌린다", () => {
    const installed = install(emptyProject());
    const shot = installed.shots?.[HANDSHAKE_SHOT_ID];
    const preview = installed.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!shot || !preview) throw new Error("fixture missing");
    const before = {
      camera: hash(shot, preview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID }),
      background: hash(shot, preview, { kind: "background" }),
      root: hash(shot, preview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA }),
      motion: hash(shot, preview, { kind: "actor_motion", subjectId: SUBJECT_IDS.actorB }),
      contact: hash(shot, preview, { kind: "contact", contact_id: "handshake_01" }),
      attachment: hash(shot, preview, { kind: "attachment" }),
      cup: createHandshakePoseSource(shot, resolveContacts(preview)).objectStream(SUBJECT_IDS.cup),
    };
    expect(resolveContacts(preview).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");

    const bus = emptyCommandBusState();
    const changed = executeCommand(installed, bus, {
      type: "CHANGE_CONTACT_EFFECTOR",
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "B",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    }, NOW);
    expect(changed.result.ok).toBe(true);
    expect(changed.bus.undoStack).toHaveLength(1);
    const nextShot = changed.project.shots?.[HANDSHAKE_SHOT_ID];
    const nextPreview = changed.project.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!nextShot || !nextPreview) throw new Error("fixture missing");
    expect(nextShot).toBe(shot);
    expect(changed.project.worlds["world-apartment-livingroom"]?.id).toBe("world-apartment-livingroom");
    expect(previewStateEqual(before.camera, hash(nextShot, nextPreview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID }))).toBe(true);
    expect(previewStateEqual(before.background, hash(nextShot, nextPreview, { kind: "background" }))).toBe(true);
    expect(previewStateEqual(before.root, hash(nextShot, nextPreview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA }))).toBe(true);
    expect(previewStateEqual(before.motion, hash(nextShot, nextPreview, { kind: "actor_motion", subjectId: SUBJECT_IDS.actorB }))).toBe(false);
    expect(previewStateEqual(before.contact, hash(nextShot, nextPreview, { kind: "contact", contact_id: "handshake_01" }))).toBe(false);
    expect(previewStateEqual(before.attachment, hash(nextShot, nextPreview, { kind: "attachment" }))).toBe(true);
    expect(createHandshakePoseSource(nextShot, resolveContacts(nextPreview)).objectStream(SUBJECT_IDS.cup)?.frames).toEqual(before.cup?.frames);
    expect(nextPreview.contacts.find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");
    expect(resolveContacts(nextPreview).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");
    const played = createHandshakePoseSource(nextShot, resolveContacts(nextPreview));
    const sourceJoints = createHandshakePoseSource(shot, resolveContacts(preview)).joints(SUBJECT_IDS.actorB, 90);
    const editedJoints = played.joints(SUBJECT_IDS.actorB, 90);
    expect(sourceJoints.right_shoulder).toBeTruthy();
    expect(editedJoints.left_shoulder).toBeTruthy();
    expect(editedJoints.right_shoulder).toBeUndefined();

    const undone = undoCommand(changed.project, changed.bus, NOW);
    expect(resolveContacts(undone.project.interactionPreviews?.[HANDSHAKE_SHOT_ID]!).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");
    const redone = redoCommand(undone.project, undone.bus, NOW);
    expect(resolveContacts(redone.project.interactionPreviews?.[HANDSHAKE_SHOT_ID]!).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");

    const raw = serializeProject(redone.project);
    const loaded = deserializeProject(raw);
    const loadedPreview = loaded.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    expect(loadedPreview?.overrides[0]?.rigPart).toBe("left_hand");
    expect(loadedPreview?.contacts.find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");
    expect(loaded.shots?.[HANDSHAKE_SHOT_ID]?.time).toMatchObject({ fps: FIXTURE_FPS, durationFrames: FIXTURE_DURATION_FRAMES });
    expect(loaded.worlds["world-apartment-livingroom"]?.name).toBe(createMeshExampleWorld().name);
  });

  it("A의 루트 키를 1mm 밀면 보존 비교가 실패한다", () => {
    const shot = createHandshakeShot();
    const preview = createHandshakePreviewRecord();
    const nudged = structuredClone(shot) as Shot;
    const actor = nudged.subjects.find((subject) => subject.id === SUBJECT_IDS.actorA);
    if (!actor || actor.kind === "light" || actor.motion.channel !== "explicit") throw new Error("root keys missing");
    const key = actor.motion.keys[0];
    const keys = actor.motion.keys.map((item, index) => (
      index === 0 ? { ...item, position: [key.position[0] + 0.001, key.position[1], key.position[2]] as [number, number, number] } : item
    ));
    actor.motion = { ...actor.motion, keys: [keys[0], ...keys.slice(1)] };
    const selector = { kind: "actor_root_motion" as const, subjectId: SUBJECT_IDS.actorA };
    expect(previewStateEqual(projectPreviewState(shot, preview, selector), projectPreviewState(nudged, preview, selector))).toBe(false);
  });

  it("없는 이름은 프로젝트를 바꾸지 않고, 이미 설치된 장면은 다시 설치해도 언두가 늘지 않는다", () => {
    const installed = install(emptyProject());
    const missed = changeContactEffector(installed, {
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "없는사람",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    });
    expect("error" in missed).toBe(true);
    if ("error" in missed) expect(missed).toMatchObject({ error: expect.stringContaining("없는사람") });
    const applied = applyCommand(installed, {
      type: "CHANGE_CONTACT_EFFECTOR",
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "없는사람",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    }, { timestamp: NOW });
    expect(applied.result.ok).toBe(false);
    expect(applied.project).toBe(installed);

    const first = executeCommand(emptyProject(), emptyCommandBusState(), { type: "INSTALL_INTERACTION_SCENE" }, NOW);
    const second = executeCommand(first.project, first.bus, { type: "INSTALL_INTERACTION_SCENE" }, NOW);
    expect(second.result.inverse).toBeUndefined();
    expect(second.bus.undoStack).toHaveLength(first.bus.undoStack.length);
    expect(second.project).toBe(first.project);
  });

  it("텍스처 메시로 표시된 A와 B에서도 손만 바꾸고 카메라와 A 루트는 남긴다", () => {
    const installed = install(emptyProject());
    const shot = installed.shots?.[HANDSHAKE_SHOT_ID];
    const preview = installed.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!shot || !preview) throw new Error("fixture missing");
    const textured = {
      ...shot,
      subjects: shot.subjects.map((subject) =>
        subject.kind === "human"
          ? { ...subject, representation: "mesh" as const, uri: `actors/${subject.id}.textured.glb` }
          : subject,
      ),
    };
    const project = { ...installed, shots: { ...installed.shots, [HANDSHAKE_SHOT_ID]: textured } };
    const beforeCamera = hash(textured, preview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID });
    const beforeRoot = hash(textured, preview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA });
    const changed = executeCommand(project, emptyCommandBusState(), {
      type: "CHANGE_CONTACT_EFFECTOR",
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "B",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    }, NOW);
    expect(changed.result.ok).toBe(true);
    const next = changed.project.shots?.[HANDSHAKE_SHOT_ID];
    const nextPreview = changed.project.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!next || !nextPreview) throw new Error("fixture missing");
    expect(next).toBe(textured);
    const actorA = next.subjects.find((subject) => subject.id === SUBJECT_IDS.actorA);
    const actorB = next.subjects.find((subject) => subject.id === SUBJECT_IDS.actorB);
    expect(actorA?.kind === "human" && actorA.uri).toBe(`actors/${SUBJECT_IDS.actorA}.textured.glb`);
    expect(actorB?.kind === "human" && actorB.uri).toBe(`actors/${SUBJECT_IDS.actorB}.textured.glb`);
    expect(previewStateEqual(beforeCamera, hash(next, nextPreview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID }))).toBe(true);
    expect(previewStateEqual(beforeRoot, hash(next, nextPreview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA }))).toBe(true);
    expect(resolveContacts(nextPreview).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");
  });

  it("텍스트 포즈와 접촉 손 변경은 한 언두로 합쳐지지 않는다", () => {
    const installed = install(emptyProject());
    const posed = executeCommand(installed, emptyCommandBusState(), {
      type: "SHOT",
      command: {
        type: "SET_TEXT_POSE",
        shotId: shotId(HANDSHAKE_SHOT_ID),
        subjectId: subjectId(SUBJECT_IDS.actorB),
        prompt: "오른손을 든다",
      },
    }, NOW);
    const changed = executeCommand(posed.project, posed.bus, {
      type: "CHANGE_CONTACT_EFFECTOR",
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "B",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    }, NOW);
    expect(changed.bus.undoStack).toHaveLength(2);
    const undone = undoCommand(changed.project, changed.bus, NOW);
    const subject = undone.project.shots?.[HANDSHAKE_SHOT_ID]?.subjects.find((item) => item.id === SUBJECT_IDS.actorB);
    expect(subject && subject.kind !== "light" && subject.motion.channel === "text" && subject.motion.prompt).toBe("오른손을 든다");
    expect(resolveContacts(undone.project.interactionPreviews?.[HANDSHAKE_SHOT_ID]!).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("right_hand");
  });

  it("기하 버퍼가 있는 텍스처 리그에서 B의 손만 바꿔도 카메라와 A의 생성 루트는 남는다", () => {
    const glbPath = fileURLToPath(new URL("./fixtures/CesiumMan.glb", import.meta.url));
    const rootPath = fileURLToPath(new URL("./fixtures/wave-walk-root.json", import.meta.url));
    const mesh = readTexturedRig(readFileSync(glbPath));
    expect(mesh.positionCount).toBeGreaterThan(1000);
    expect(mesh.positionBytes).toBeGreaterThan(1000);
    const png = mesh.imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = mesh.imageBytes[0] === 0xff && mesh.imageBytes[1] === 0xd8 && mesh.imageBytes[2] === 0xff;
    expect(png || jpeg).toBe(true);
    const ids = createPersistentIdFactory({ now: () => 0, randomBytes: () => new Uint8Array(10) });
    const actorA = importRiggedActor(phase0Scene(), {
      assetId: "ast_phase0_a",
      revisionId: "rev_phase0_a_v1",
      sourcePath: glbPath,
      nodeName: "Armature",
      label: "A",
      bones: mesh.jointNames.map((name) => ({ name })),
      restTranslation: [0, 0, 0],
    }, ids);
    const actorB = importRiggedActor(actorA.scene, {
      assetId: "ast_phase0_b",
      revisionId: "rev_phase0_b_v1",
      sourcePath: `${glbPath}#b`,
      nodeName: "Armature",
      label: "B",
      bones: mesh.jointNames.map((name) => ({ name })),
      restTranslation: [0, 0, 0],
    }, ids);
    expect(newIdSchema("act").safeParse(actorA.actor.id).success).toBe(true);
    expect(actorB.actor.id).not.toBe(actorA.actor.id);
    const root = rootFixtureSchema.parse(JSON.parse(readFileSync(rootPath, "utf8")));
    expect(root.rootSha256).toBe("adb44cc5a9931e33598faf8954a98e52b3dfefc06212fcc15e6fbd01aeb12531");
    expect(root.frames.length).toBeLessThan(FIXTURE_DURATION_FRAMES);
    expect(root.frames[root.frames.length - 1]?.position[2]).toBeGreaterThan((root.frames[0]?.position[2] ?? 0) + 1);

    const installed = install(emptyProject());
    const shot = installed.shots?.[HANDSHAKE_SHOT_ID];
    if (!shot) throw new Error("fixture missing");
    const linked = {
      ...shot,
      subjects: shot.subjects.map((subject) => {
        if (subject.kind !== "human") return subject;
        const instanceId = subject.id === SUBJECT_IDS.actorA ? actorA.actor.id : actorB.actor.id;
        return { ...subject, representation: "mesh" as const, uri: glbPath, instanceId };
      }),
    };
    let project: Project = { ...installed, shots: { ...installed.shots, [HANDSHAKE_SHOT_ID]: linked } };
    let bus = emptyCommandBusState();
    for (const frame of root.frames) {
      const posed = executeCommand(project, bus, {
        type: "SHOT",
        command: {
          type: "KEY_SUBJECT_POSE",
          shotId: shotId(HANDSHAKE_SHOT_ID),
          subjectId: subjectId(SUBJECT_IDS.actorA),
          key: {
            frame: frame.frame,
            position: frame.position,
            rotationEuler: frame.rotationEuler,
            scale: [1, 1, 1],
          },
        },
      }, NOW);
      expect(posed.result.ok).toBe(true);
      project = posed.project;
      bus = posed.bus;
    }
    const posedShot = project.shots?.[HANDSHAKE_SHOT_ID];
    const preview = project.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!posedShot || !preview) throw new Error("fixture missing");
    const beforeCamera = hash(posedShot, preview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID });
    const beforeBackground = hash(posedShot, preview, { kind: "background" });
    const beforeRoot = hash(posedShot, preview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA });
    const changed = executeCommand(project, bus, {
      type: "CHANGE_CONTACT_EFFECTOR",
      shotId: HANDSHAKE_SHOT_ID,
      subjectRef: "B",
      locale: "ko",
      contactId: "handshake_01",
      rigPart: "left_hand",
    }, NOW);
    expect(changed.result.ok).toBe(true);
    const next = changed.project.shots?.[HANDSHAKE_SHOT_ID];
    const nextPreview = changed.project.interactionPreviews?.[HANDSHAKE_SHOT_ID];
    if (!next || !nextPreview) throw new Error("fixture missing");
    expect(next).toBe(posedShot);
    expect(previewStateEqual(beforeCamera, hash(next, nextPreview, { kind: "camera_track", takeId: HANDSHAKE_TAKE_ID }))).toBe(true);
    expect(previewStateEqual(beforeBackground, hash(next, nextPreview, { kind: "background" }))).toBe(true);
    expect(previewStateEqual(beforeRoot, hash(next, nextPreview, { kind: "actor_root_motion", subjectId: SUBJECT_IDS.actorA }))).toBe(true);
    const kept = next.subjects.find((subject) => subject.id === SUBJECT_IDS.actorA);
    const edited = next.subjects.find((subject) => subject.id === SUBJECT_IDS.actorB);
    expect(kept?.kind === "human" && kept.instanceId).toBe(actorA.actor.id);
    expect(edited?.kind === "human" && edited.instanceId).toBe(actorB.actor.id);
    expect(kept?.kind === "human" && kept.uri).toBe(glbPath);
    if (!kept || kept.kind === "light" || kept.motion.channel !== "explicit") throw new Error("A root missing");
    const last = root.frames[root.frames.length - 1];
    if (!last) throw new Error("root fixture empty");
    expect(kept.motion.keys.find((key) => key.frame === 0)?.position[2]).toBeCloseTo(root.frames[0]?.position[2] ?? 0, 5);
    expect(kept.motion.keys.find((key) => key.frame === last.frame)?.position).toEqual(last.position);
    expect(kept.motion.keys.find((key) => key.frame === 64)?.position).toEqual([...ACTOR_A_ROOT]);
    expect(resolveContacts(nextPreview).find((contact) => contact.contactId === "handshake_01")?.b.rigPart).toBe("left_hand");
  });
});

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const rootFixtureSchema = z.object({
  rootSha256: z.string().length(64),
  frames: z.array(z.object({
    frame: z.number().int().nonnegative(),
    position: vec3Schema,
    rotationEuler: vec3Schema,
  })).min(2),
});

const gltfSchema = z.object({
  nodes: z.array(z.object({ name: z.string().optional() })),
  skins: z.array(z.object({ joints: z.array(z.number().int().nonnegative()).min(1) })).min(1),
  meshes: z.array(z.object({
    primitives: z.array(z.object({
      attributes: z.object({ POSITION: z.number().int().nonnegative() }),
    })).min(1),
  })).min(1),
  images: z.array(z.object({ bufferView: z.number().int().nonnegative() })).min(1),
  accessors: z.array(z.object({
    bufferView: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    type: z.string(),
  })),
  bufferViews: z.array(z.object({
    byteOffset: z.number().int().nonnegative().optional(),
    byteLength: z.number().int().positive(),
  })),
});

const readTexturedRig = (bytes: Buffer) => {
  if (bytes.toString("utf8", 0, 4) !== "glTF") throw new Error("glb magic");
  const jsonLength = bytes.readUInt32LE(12);
  const document = gltfSchema.parse(JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const viewAt = (index: number) => {
    const view = document.bufferViews[index];
    if (!view) throw new Error("buffer view missing");
    const start = binStart + (view.byteOffset ?? 0);
    return bytes.subarray(start, start + view.byteLength);
  };
  const positionAccessor = document.accessors[document.meshes[0]?.primitives[0]?.attributes.POSITION ?? -1];
  if (!positionAccessor || positionAccessor.type !== "VEC3") throw new Error("position accessor missing");
  const imageView = document.images[0]?.bufferView;
  if (imageView === undefined) throw new Error("image missing");
  const skin = document.skins[0];
  if (!skin) throw new Error("skin missing");
  const jointNames = skin.joints.map((joint) => {
    const name = document.nodes[joint]?.name;
    if (!name) throw new Error("joint name missing");
    return name;
  });
  return {
    positionCount: positionAccessor.count,
    positionBytes: viewAt(positionAccessor.bufferView).byteLength,
    imageBytes: viewAt(imageView),
    jointNames,
  };
};
