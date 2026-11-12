import { describe, expect, it } from "vitest";
import { emptyCommandBusState, executeCommand, redoCommand, undoCommand } from "../../application/commands/bus";
import { applyCommand } from "../../application/commands/apply";
import { deserializeProject, serializeProject } from "../../infrastructure/persistence";
import { shotId, subjectId } from "../shot";
import { createMeshExampleWorld } from "../worlds/sampleWorlds";
import type { Project } from "../project/types";
import type { Shot } from "../shot/types";
import {
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
});
