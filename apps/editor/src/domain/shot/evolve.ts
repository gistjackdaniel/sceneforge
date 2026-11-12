import type { AssetRecord } from "../assets/types";
import {
  identityCalibration,
  identityMapping,
  mirrorsSamples,
  resolveVirtualKeyframes,
  samplesFromKeyframes,
} from "./cameraTrack";
import { parseShot } from "./schema";
import { generateHash } from "./queries";
import { mintCameraTakeId, reservedCameraTakeIds } from "./takeId";
import type {
  AssetId,
  CameraKey,
  CameraSample,
  CameraTake,
  Motion,
  Shot,
  ShotCamera,
  ShotCommand,
  Subject,
  SubjectDraft,
  SubjectId,
  TakeId,
  Transform,
} from "./types";

export type ShotEdit =
  | { ok: true; shot: Shot; inverse?: ShotCommand; asset?: AssetRecord; changed: boolean }
  | { ok: false; reason: string };

const brandId = <T extends string>(value: string) => value as T;

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const defaultPlacement = (): Transform => ({
  position: [0, 0.5, 0],
  rotationEuler: [0, 0, 0],
  scale: [1, 1, 1],
});

const assetFor = (draft: SubjectDraft): { assetId: AssetId; uri: string; name: string; type: AssetRecord["type"] } => {
  if (draft.kind === "light") return { assetId: brandId<AssetId>("primitive:light"), uri: "primitive:light", name: "Light", type: "lighting_preset" };
  if (draft.kind === "marker") return { assetId: brandId<AssetId>("primitive:marker"), uri: "primitive:marker", name: "Marker", type: "prop" };
  if ("primitive" in draft) {
    const id = draft.primitive === "box" ? "primitive:box" : "primitive:sphere";
    return { assetId: brandId<AssetId>(id), uri: id, name: draft.primitive === "box" ? "Box" : "Sphere", type: "prop" };
  }
  const assetId = brandId<AssetId>(`file:${hashText(draft.fileUri)}`);
  return { assetId, uri: draft.fileUri, name: draft.name, type: draft.kind === "human" ? "actor" : "mesh" };
};

const assetRecord = (draft: SubjectDraft, stamped: string): AssetRecord => {
  const asset = assetFor(draft);
  return {
    id: asset.assetId,
    type: asset.type,
    name: asset.name,
    uri: asset.uri,
    contentHash: asset.assetId,
    metadata: {},
    semanticTags: ["shot"],
    version: 1,
    createdAt: stamped,
    updatedAt: stamped,
  };
};

const nonEmpty = <T>(items: readonly T[]): [T, ...T[]] | undefined =>
  items.length > 0 ? [items[0], ...items.slice(1)] : undefined;

const sortKeys = <T extends { frame: number }>(keys: readonly T[]) => [...keys].sort((left, right) => left.frame - right.frame);

const inClock = (shot: Shot, frame: number) => frame >= 0 && frame < shot.time.durationFrames;

const replaceSubject = (shot: Shot, subject: Subject): Shot => ({
  ...shot,
  subjects: shot.subjects.map((item) => item.id === subject.id ? subject : item),
});

const finish = (shot: Shot, inverse: ShotCommand | undefined, changed: boolean, asset?: AssetRecord): ShotEdit => {
  try {
    const parsed = parseShot(shot);
    return changed ? { ok: true, shot: parsed, inverse, asset, changed } : { ok: true, shot: parsed, changed: false };
  } catch {
    return { ok: false, reason: "Shot record is invalid." };
  }
};

const textMotion = (prompt: string): Motion => {
  const trimmed = prompt.trim();
  return trimmed ? { channel: "text", prompt: trimmed } : { channel: "unset" };
};

const withTake = (shot: Shot, take: CameraTake): ShotEdit => {
  const takes = shot.camera.status === "ready" ? [...shot.camera.takes, take] : [take];
  const packed = nonEmpty(takes);
  if (!packed) return { ok: false, reason: "A camera take needs a key inside the shot." };
  return finish(
    {
      ...shot,
      camera: {
        status: "ready",
        lens: shot.camera.lens,
        interpolation: shot.camera.interpolation,
        selectedTakeId: take.id,
        takes: packed,
        retiredTakeIds: shot.camera.retiredTakeIds,
      },
    },
    { type: "REPLACE_CAMERA", shotId: shot.id, camera: shot.camera },
    true,
  );
};

const takeNumber = (camera: ShotCamera): number => {
  const names = camera.status === "ready" ? camera.takes.map((take) => take.name) : [];
  const used = names.map((name) => {
    const match = /^Take (\d+)$/.exec(name);
    return match ? Number(match[1]) : 0;
  });
  return Math.max(0, ...used, camera.status === "ready" ? camera.takes.length : 0) + 1;
};

const copySample = (sample: CameraSample): CameraSample => ({
  ...sample,
  position: [sample.position[0], sample.position[1], sample.position[2]],
  rotation: [sample.rotation[0], sample.rotation[1], sample.rotation[2], sample.rotation[3]],
  trackingState: sample.trackingState,
});

const buildTake = (
  shot: Shot,
  input: {
    source: CameraTake["source"];
    name: string;
    keys: readonly CameraKey[];
    samples?: readonly CameraSample[];
    intrinsics?: CameraTake["intrinsics"];
    calibration?: CameraTake["calibration"];
    trackingEvents?: CameraTake["trackingEvents"];
    mapping?: CameraTake["mapping"];
    now: string;
  },
): CameraTake | undefined => {
  const calibration = input.calibration ?? identityCalibration();
  const mapping = input.mapping ?? identityMapping();
  const provided = (input.samples ?? []).filter((sample) => inClock(shot, sample.frame)).map(copySample);
  const keyed = input.keys.filter((key) => inClock(shot, key.frame));
  const samples = provided.length > 0 ? provided : samplesFromKeyframes(keyed, shot.time.fps);
  if (samples.length === 0) return undefined;
  const keys = nonEmpty(resolveVirtualKeyframes({
    samples,
    calibration,
    mapping,
    intrinsics: input.intrinsics,
    trackingEvents: input.trackingEvents,
  }));
  if (!keys) return undefined;
  return {
    schemaVersion: 1,
    id: brandId<TakeId>(mintCameraTakeId(reservedCameraTakeIds(shot.camera))),
    name: input.name,
    source: input.source,
    keys,
    createdAt: input.now,
    samples,
    intrinsics: input.intrinsics,
    calibration,
    trackingEvents: input.trackingEvents ? [...input.trackingEvents] : [],
    mapping,
    legacyRefs: [],
    rotationStorage: "quaternion_xyzw",
  };
};

const retarget = (
  take: CameraTake,
  patch: { mapping?: CameraTake["mapping"]; calibration?: CameraTake["calibration"] },
): CameraTake | undefined => {
  const next = { ...take, ...patch, samples: take.samples };
  const keys = nonEmpty(resolveVirtualKeyframes(next));
  if (!keys) return undefined;
  return { ...next, keys };
};

export const applyShotCommand = (shot: Shot, command: ShotCommand, now = new Date().toISOString()): ShotEdit => {
  if (command.type !== "REPLACE_SHOT" && command.shotId !== shot.id) return { ok: false, reason: "Shot not found." };
  const fail = (reason: string): ShotEdit => ({ ok: false, reason });
  const subjectAt = (id: SubjectId) => shot.subjects.find((item) => item.id === id);

  switch (command.type) {
    case "ADD_SUBJECT": {
      const asset = assetFor(command.draft);
      const id = brandId<SubjectId>(command.draft.id ?? `subject-${hashText(`${now}:${shot.subjects.length}:${command.draft.name}`)}`);
      if (shot.subjects.some((item) => item.id === id)) return fail("Subject already exists.");
      const placement = command.draft.placement ?? defaultPlacement();
      const base = {
        id,
        assetId: asset.assetId,
        assetVersion: 1,
        name: command.draft.name.trim() || asset.name,
        uri: asset.uri,
        placement,
        visible: true,
        locked: false,
      };
      const subject: Subject = command.draft.kind === "light"
        ? { ...base, kind: "light", representation: "light", intensity: 2, color: "#fff4d6" }
        : {
            ...base,
            kind: command.draft.kind === "human" ? "human" : command.draft.kind === "marker" ? command.draft.role : "object",
            representation: command.draft.kind === "marker" ? "marker" : "primitive" in command.draft ? command.draft.primitive : "mesh",
            motion: { channel: "unset" },
          };
      return finish(
        { ...shot, subjects: [...shot.subjects, subject] },
        { type: "REMOVE_SUBJECT", shotId: shot.id, subjectId: id },
        true,
        assetRecord(command.draft, now),
      );
    }
    case "REMOVE_SUBJECT": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      return finish(
        { ...shot, subjects: shot.subjects.filter((item) => item.id !== subject.id) },
        { type: "REPLACE_SUBJECT", shotId: shot.id, subject },
        true,
      );
    }
    case "REPLACE_SUBJECT": {
      const previous = subjectAt(command.subject.id);
      if (!previous) {
        return finish(
          { ...shot, subjects: [...shot.subjects, command.subject] },
          { type: "REMOVE_SUBJECT", shotId: shot.id, subjectId: command.subject.id },
          true,
        );
      }
      if (JSON.stringify(previous) === JSON.stringify(command.subject)) return finish(shot, undefined, false);
      return finish(replaceSubject(shot, command.subject), { type: "REPLACE_SUBJECT", shotId: shot.id, subject: previous }, true);
    }
    case "REPLACE_CAMERA":
      if (JSON.stringify(shot.camera) === JSON.stringify(command.camera)) return finish(shot, undefined, false);
      return finish({ ...shot, camera: command.camera }, { type: "REPLACE_CAMERA", shotId: shot.id, camera: shot.camera }, true);
    case "REPLACE_SHOT":
      if (command.shot.id !== shot.id) return fail("Shot not found.");
      return finish(command.shot, { type: "REPLACE_SHOT", shotId: shot.id, shot }, true);
    case "DROP_RENDER": {
      const receipt = shot.renders.find((render) => render.id === command.renderId);
      if (!receipt) return finish(shot, undefined, false);
      return finish(
        { ...shot, renders: shot.renders.filter((render) => render.id !== receipt.id) },
        { type: "RECORD_SHOT_RENDER", shotId: shot.id, receipt },
        true,
      );
    }
    case "SET_SUBJECT_PLACEMENT": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      return finish(
        replaceSubject(shot, { ...subject, placement: command.placement }),
        { type: "SET_SUBJECT_PLACEMENT", shotId: shot.id, subjectId: subject.id, placement: subject.placement },
        true,
      );
    }
    case "SET_SUBJECT_FLAGS": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      const next = { ...subject, visible: command.visible ?? subject.visible, locked: command.locked ?? subject.locked };
      return finish(
        replaceSubject(shot, next),
        { type: "SET_SUBJECT_FLAGS", shotId: shot.id, subjectId: subject.id, visible: subject.visible, locked: subject.locked },
        true,
      );
    }
    case "SET_LIGHT": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      if (subject.kind !== "light") return fail("Only a light has intensity and color.");
      return finish(
        replaceSubject(shot, { ...subject, intensity: command.intensity ?? subject.intensity, color: command.color ?? subject.color }),
        { type: "SET_LIGHT", shotId: shot.id, subjectId: subject.id, intensity: subject.intensity, color: subject.color },
        true,
      );
    }
    case "SET_TEXT_POSE": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      if (subject.kind === "light") return fail("A light has no pose.");
      const nextMotion = textMotion(command.prompt);
      if (subject.motion.channel === "explicit" && nextMotion.channel === "unset") return finish(shot, undefined, false);
      if (JSON.stringify(subject.motion) === JSON.stringify(nextMotion)) return finish(shot, undefined, false);
      const inverse: ShotCommand = subject.motion.channel === "explicit"
        ? { type: "REPLACE_SUBJECT", shotId: shot.id, subject }
        : { type: "SET_TEXT_POSE", shotId: shot.id, subjectId: subject.id, prompt: subject.motion.channel === "text" ? subject.motion.prompt : "" };
      return finish(replaceSubject(shot, { ...subject, motion: nextMotion }), inverse, true);
    }
    case "KEY_SUBJECT_POSE": {
      const subject = subjectAt(command.subjectId);
      if (!subject) return fail("Subject not found.");
      if (subject.kind === "light") return fail("A light has no pose.");
      if (!inClock(shot, command.key.frame)) return fail("Frame is outside the shot.");
      const keys = subject.motion.channel === "explicit"
        ? sortKeys([...subject.motion.keys.filter((key) => key.frame !== command.key.frame), command.key])
        : [command.key];
      const nonempty = nonEmpty(keys);
      if (!nonempty) return fail("Explicit pose needs a key.");
      const next: Subject = {
        ...subject,
        motion: {
          channel: "explicit",
          interpolation: subject.motion.channel === "explicit" ? subject.motion.interpolation : "linear",
          keys: nonempty,
          provenance: { kind: "keyed" },
        },
      };
      return finish(replaceSubject(shot, next), { type: "REPLACE_SUBJECT", shotId: shot.id, subject }, true);
    }
    case "DELETE_SUBJECT_POSE_KEY": {
      const subject = subjectAt(command.subjectId);
      if (!subject || subject.kind === "light" || subject.motion.channel !== "explicit") return fail("Explicit pose not found.");
      const keys = nonEmpty(subject.motion.keys.filter((key) => key.frame !== command.frame));
      const next: Subject = keys
        ? { ...subject, motion: { ...subject.motion, keys } }
        : { ...subject, motion: { channel: "unset" } };
      return finish(replaceSubject(shot, next), { type: "REPLACE_SUBJECT", shotId: shot.id, subject }, true);
    }
    case "COMMIT_CAMERA_TAKE":
    case "APPLY_CAMERA_PRESET": {
      const number = takeNumber(shot.camera);
      const take = buildTake(shot, {
        source: command.type === "APPLY_CAMERA_PRESET" ? "preset" : command.source,
        name: command.type === "COMMIT_CAMERA_TAKE" ? command.name ?? `Take ${number}` : `Take ${number}`,
        keys: command.keys,
        samples: command.type === "COMMIT_CAMERA_TAKE" ? command.samples : undefined,
        intrinsics: command.type === "COMMIT_CAMERA_TAKE" ? command.intrinsics : undefined,
        calibration: command.type === "COMMIT_CAMERA_TAKE" ? command.calibration : undefined,
        trackingEvents: command.type === "COMMIT_CAMERA_TAKE" ? command.trackingEvents : undefined,
        mapping: command.type === "COMMIT_CAMERA_TAKE" ? command.mapping : undefined,
        now,
      });
      if (!take) return fail("A camera take needs a key inside the shot.");
      return withTake(shot, take);
    }
    case "KEY_CAMERA": {
      if (!inClock(shot, command.key.frame)) return fail("Frame is outside the shot.");
      if (shot.camera.status === "empty") {
        const take = buildTake(shot, { source: "manual", name: "Take 1", keys: [command.key], now });
        if (!take) return fail("A camera take needs a key inside the shot.");
        return withTake(shot, take);
      }
      const camera = shot.camera;
      const selectedId = camera.selectedTakeId;
      const selected = camera.takes.find((take) => take.id === selectedId) ?? camera.takes[0];
      const keys = nonEmpty(sortKeys([...selected.keys.filter((key) => key.frame !== command.key.frame), command.key]));
      if (!keys) return fail("A camera take needs a key inside the shot.");
      const samples = mirrorsSamples(selected) ? samplesFromKeyframes(keys, shot.time.fps) : selected.samples;
      const takes = nonEmpty(camera.takes.map((take) => take.id === selected.id ? { ...take, keys, samples } : take));
      if (!takes) return fail("A camera take needs a key inside the shot.");
      return finish(
        { ...shot, camera: { ...shot.camera, takes } },
        { type: "REPLACE_CAMERA", shotId: shot.id, camera: shot.camera },
        true,
      );
    }
    case "DELETE_CAMERA_KEY": {
      if (shot.camera.status !== "ready") return fail("Camera take not found.");
      const camera = shot.camera;
      const selectedId = camera.selectedTakeId;
      const selected = camera.takes.find((take) => take.id === selectedId);
      if (!selected) return fail("Camera take not found.");
      const keys = nonEmpty(selected.keys.filter((key) => key.frame !== command.frame));
      const previous = camera;
      const retire = (id: TakeId) => [...camera.retiredTakeIds, id];
      const takes = keys
        ? camera.takes.map((take) => take.id === selected.id
          ? { ...take, keys, samples: mirrorsSamples(take) ? samplesFromKeyframes(keys, shot.time.fps) : take.samples }
          : take)
        : camera.takes.filter((take) => take.id !== selected.id);
      const packed = nonEmpty(takes);
      const nextCamera = packed
        ? {
            ...camera,
            selectedTakeId: packed.some((take) => take.id === selectedId) ? selectedId : packed[0].id,
            takes: packed,
            retiredTakeIds: keys ? camera.retiredTakeIds : retire(selected.id),
          }
        : { status: "empty" as const, lens: camera.lens, interpolation: camera.interpolation, retiredTakeIds: retire(selected.id) };
      return finish({ ...shot, camera: nextCamera }, { type: "REPLACE_CAMERA", shotId: shot.id, camera: previous }, true);
    }
    case "SET_CAMERA_TRACK_MAPPING":
    case "SET_DEVICE_CALIBRATION": {
      if (shot.camera.status !== "ready") return fail("Camera take not found.");
      const camera = shot.camera;
      const targetId = command.takeId ?? camera.selectedTakeId;
      const selected = camera.takes.find((take) => take.id === targetId);
      if (!selected) return fail("Camera take not found.");
      const next = retarget(selected, command.type === "SET_CAMERA_TRACK_MAPPING"
        ? { mapping: command.mapping }
        : { calibration: command.calibration });
      if (!next) return fail("A camera take needs a key inside the shot.");
      const takes = nonEmpty(camera.takes.map((take) => take.id === selected.id ? next : take));
      if (!takes) return fail("A camera take needs a key inside the shot.");
      return finish(
        { ...shot, camera: { ...camera, takes } },
        { type: "REPLACE_CAMERA", shotId: shot.id, camera: camera },
        true,
      );
    }
    case "SELECT_CAMERA_TAKE": {
      if (shot.camera.status !== "ready" || !shot.camera.takes.some((take) => take.id === command.takeId)) return fail("Camera take not found.");
      if (shot.camera.selectedTakeId === command.takeId) return finish(shot, undefined, false);
      return finish(
        { ...shot, camera: { ...shot.camera, selectedTakeId: command.takeId } },
        { type: "SELECT_CAMERA_TAKE", shotId: shot.id, takeId: shot.camera.selectedTakeId },
        true,
      );
    }
    case "DELETE_CAMERA_TAKE": {
      if (shot.camera.status !== "ready") return fail("Camera take not found.");
      const camera = shot.camera;
      const selectedId = camera.selectedTakeId;
      const previous = camera;
      const removed = camera.takes.find((take) => take.id === command.takeId);
      if (!removed) return fail("Camera take not found.");
      const retiredTakeIds = [...camera.retiredTakeIds, removed.id];
      const packed = nonEmpty(camera.takes.filter((take) => take.id !== command.takeId));
      const nextCamera = packed
        ? {
            ...camera,
            selectedTakeId: packed.some((take) => take.id === selectedId) ? selectedId : packed[0].id,
            takes: packed,
            retiredTakeIds,
          }
        : { status: "empty" as const, lens: camera.lens, interpolation: camera.interpolation, retiredTakeIds };
      return finish({ ...shot, camera: nextCamera }, { type: "REPLACE_CAMERA", shotId: shot.id, camera: previous }, true);
    }
    case "SET_LENS":
      return finish(
        { ...shot, camera: { ...shot.camera, lens: command.lens } },
        { type: "SET_LENS", shotId: shot.id, lens: shot.camera.lens },
        true,
      );
    case "SET_CAMERA_INTERPOLATION":
      if (shot.camera.interpolation === command.interpolation) return finish(shot, undefined, false);
      return finish(
        { ...shot, camera: { ...shot.camera, interpolation: command.interpolation } },
        { type: "SET_CAMERA_INTERPOLATION", shotId: shot.id, interpolation: shot.camera.interpolation },
        true,
      );
    case "TRIM_KEYS": {
      const subjects = shot.subjects.map((subject) => {
        if (subject.kind === "light" || subject.motion.channel !== "explicit") return subject;
        const keys = nonEmpty(subject.motion.keys.filter((key) => inClock(shot, key.frame)));
        return keys ? { ...subject, motion: { ...subject.motion, keys } } : { ...subject, motion: { channel: "unset" as const } };
      });
      let camera = shot.camera;
      if (camera.status === "ready") {
        const dropped: TakeId[] = [];
        const takes = nonEmpty(camera.takes.flatMap((take) => {
          const samples = take.samples.filter((sample) => inClock(shot, sample.frame));
          const keys = nonEmpty(samples.length > 0
            ? resolveVirtualKeyframes({ ...take, samples })
            : take.keys.filter((key) => inClock(shot, key.frame)));
          if (!keys) {
            dropped.push(take.id);
            return [];
          }
          return [{ ...take, keys, samples: samples.length > 0 ? samples : samplesFromKeyframes(keys, shot.time.fps) }];
        }));
        const selectedId = camera.selectedTakeId;
        camera = takes
          ? {
              ...camera,
              selectedTakeId: takes.some((take) => take.id === selectedId) ? selectedId : takes[0].id,
              takes,
              retiredTakeIds: [...camera.retiredTakeIds, ...dropped],
            }
          : {
              status: "empty",
              lens: camera.lens,
              interpolation: camera.interpolation,
              retiredTakeIds: [...camera.retiredTakeIds, ...camera.takes.map((take) => take.id)],
            };
      }
      return finish({ ...shot, subjects, camera }, { type: "REPLACE_SHOT", shotId: shot.id, shot }, true);
    }
    case "SET_SHOT_TIME":
      if (!(command.fps > 0) || command.durationFrames < 1) return fail("Shot time is invalid.");
      return finish(
        { ...shot, time: { ...shot.time, fps: command.fps, durationFrames: Math.round(command.durationFrames) } },
        { type: "SET_SHOT_TIME", shotId: shot.id, fps: shot.time.fps, durationFrames: shot.time.durationFrames },
        true,
      );
    case "RECORD_SHOT_RENDER": {
      if (shot.renders.some((render) => render.jobId === command.receipt.jobId)) return finish(shot, undefined, false);
      return finish(
        { ...shot, renders: [...shot.renders, { ...command.receipt, generateHash: command.receipt.generateHash || generateHash(shot) }] },
        { type: "DROP_RENDER", shotId: shot.id, renderId: command.receipt.id },
        true,
      );
    }
    default:
      return fail("Unhandled shot command.");
  }
};
