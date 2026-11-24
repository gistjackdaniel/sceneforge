import { editShotEditorial } from "../shot/editorial";
import { eulerToQuaternion } from "../shot/eulerAdapter";
import { linkShotSubjects } from "../shot/instanceLink";
import type { MotionSource } from "../shot/motionConditions";
import { shotId, takeId, type Shot } from "../shot/types";
import { PHASE1_CLASSROOM_WORLD, shotWorldRevisionId } from "../worlds/importedShotWorld";
import { createHandshakeShot, SUBJECT_IDS } from "./fixture";

export const PHASE1_SHOT_ID = "shot-phase1-edit-review";
export const PHASE1_WORLD_ID = "world-phase1-classroom";
export const PHASE1_ACTORS = { a: SUBJECT_IDS.actorA, b: SUBJECT_IDS.actorB } as const;

export const PHASE1_MOTIONS = {
  walk: {
    uri: "/motions/wave-walk.json",
    sha256: "a97210e55ed739286ba94fb6cb09760c20771571ebe69ffdfb77b5401fdf9424",
    model: "Kimodo-SOMA-RP-ArdyRep-v1.2",
    prompt: "A person waves with the left hand and walks forward.",
    seed: 0, fps: 30, frameCount: 60,
  },
  wave: {
    uri: "/motions/step-and-wave.json",
    sha256: "ffb54942b1652399be45af9d7589dfdc4074ed191e78a43596aef21eb9600ad8",
    model: "Kimodo-SOMA-RP-ArdyRep-v1.2",
    prompt: "A person stands in place and warmly waves their right hand high toward someone in front of them, then relaxes their arm.",
    seed: 2, fps: 30, frameCount: 120,
  },
  bow: {
    uri: "/motions/step-and-bow.json",
    sha256: "2907575eb24256d00b64c47bc0a2ebf421a861895421254d44a3f76b724ef9b2",
    model: "Kimodo-SOMA-RP-ArdyRep-v1.2",
    prompt: "A person stands with hands at their sides, makes a deep polite forward bow, then slowly stands straight again.",
    seed: 3, fps: 30, frameCount: 120,
  },
} satisfies Record<string, MotionSource>;

/** Assemble the review shot with model clips and an immutable room revision. */
export const createPhase1DemoShot = (timestamp: string): Shot => {
  const base = createHandshakeShot();
  if (base.camera.status !== "ready") throw new Error("Missing review camera");
  const rotation = eulerToQuaternion([-0.10, 0, 0]);
  const cameraId = takeId("cam_phase1_classroom");
  const shot = linkShotSubjects({
    ...base,
    id: shotId(PHASE1_SHOT_ID),
    name: "Classroom · motion review",
    time: { fps: 30, durationFrames: 120, origin: "clip_local" },
    environment: { worldId: PHASE1_WORLD_ID, revisionId: shotWorldRevisionId(PHASE1_CLASSROOM_WORLD) },
    subjects: base.subjects.flatMap((subject) => {
      if (subject.kind !== "human") return [];
      const isA = subject.id === PHASE1_ACTORS.a;
      const label = isA ? "a" : "b";
      return [{
        ...subject,
        assetVersion: 2,
        assetRef: { assetId: `ast_demo_${label}`, revisionId: `rev_demo_${label}_v2` },
        uri: `/meshes/phase1/actor-${label}.glb`,
        placement: { position: [isA ? 0.82 : 1.88, 0, isA ? -1.6 : 0.08], rotationEuler: [0, 0, 0], scale: [0.60, 0.60, 0.60] },
        motion: { channel: "unset" },
      }];
    }),
    camera: {
      status: "ready",
      lens: { focalLengthMm: 28 },
      interpolation: "linear",
      selectedTakeId: cameraId,
      retiredTakeIds: [],
      takes: [{
        ...base.camera.takes[0],
        id: cameraId,
        name: "Classroom wide",
        keys: [{ frame: 0, position: [1.17, 1.28, 4.1], rotation, focalLengthMm: 28 }],
        samples: [],
        legacyRefs: [],
      }],
    },
  });
  const edited = editShotEditorial(shot, { type: "SET_TIMELINE_MOTION", shotId: shot.id, edits: [
    { subjectId: PHASE1_ACTORS.a, source: PHASE1_MOTIONS.walk, startFrame: 0, endFrame: 120 },
    { subjectId: PHASE1_ACTORS.b, source: PHASE1_MOTIONS.wave, startFrame: 0, endFrame: 120 },
  ] }, timestamp);
  if (!edited.ok) throw new Error(edited.reason);
  return edited.shot;
};
