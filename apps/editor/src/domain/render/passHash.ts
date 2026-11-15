import { computePassHash } from "../../core/dependency";
import type { CameraTake, Lens, Quat, Shot, Subject, Vec3 } from "../shot/types";
import { selectedTake } from "../shot/queries";
import type { InstanceIdEntry, RenderPassKind, RenderPassSpec } from "./types";
import { RENDER_PASS_KINDS, RENDERER_VERSION } from "./types";

/**
 * Dependency keys for one protected AOV.
 *
 * The digest is one `computePassHash` call (`core/dependency`, which is
 * `hashNormalized`). Identity strings stay out of this object. Only the
 * instance-id pass adds `instanceMapHash`.
 *
 * `passHash` is the upstream digest, not this AOV's own digest.
 * `modelVersion` is the renderer version.
 */
export type RenderPassHashInput = {
  assetRevision: { assetId: string; revisionId: string };
  modelVersion: string;
  seed: number;
  passHash: string;
  passKind: RenderPassKind;
  frameRange: readonly [number, number];
  fps: number;
  instanceMapHash?: string;
};

export type AssetRevisionKey = RenderPassHashInput["assetRevision"];

export type FrameRange = { start: number; end: number };

export type HashContext = {
  spec: RenderPassSpec;
  frameRange: FrameRange;
  assetRevision: AssetRevisionKey;
  seed: number;
  /** Replaces the derived ID→pixel table. Ids must be the scene's current ids. */
  instanceTable?: readonly InstanceIdEntry[];
};

const byFrame = <T extends { frame: number }>(keys: readonly T[]): T[] =>
  [...keys].sort((left, right) => left.frame - right.frame);

const lensRecord = (lens: Lens): Record<string, unknown> => ({
  focalLengthMm: lens.focalLengthMm,
  ...(lens.focusDistanceM !== undefined ? { focusDistanceM: lens.focusDistanceM } : {}),
  ...(lens.aperture !== undefined ? { aperture: lens.aperture } : {}),
  ...(lens.sensorPreset !== undefined ? { sensorPreset: lens.sensorPreset } : {}),
});

const subjectContent = (subject: Subject): Record<string, unknown> => {
  const shared = {
    assetId: subject.assetId,
    assetVersion: subject.assetVersion,
    uri: subject.uri,
    visible: subject.visible,
    placement: subject.placement,
  };
  if (subject.kind === "light") {
    return { ...shared, kind: subject.kind, intensity: subject.intensity, color: subject.color };
  }
  const motion = subject.motion.channel === "explicit"
    ? { ...subject.motion, keys: byFrame(subject.motion.keys) }
    : subject.motion;
  return { ...shared, kind: subject.kind, representation: subject.representation, motion };
};

/**
 * Upstream payload hashed into the parent `passHash`.
 * The shot still addresses targets by their current persistent ids; those
 * strings are not copied here. Display names, take ids, legacy ids, room
 * instance ids, calibration ids, and render receipts are omitted. `fps` is a
 * top-level pass-hash field (`Shot.time.fps`), not part of this payload.
 * Resolution and clip planes live here because every AOV shares them.
 * Calibration, drift, and mapping values are included only when they are not
 * the identity layer parse injects for a take that stored none.
 */
const zeroVec = (value: Vec3): boolean => value[0] === 0 && value[1] === 0 && value[2] === 0;
const oneVec = (value: Vec3): boolean => value[0] === 1 && value[1] === 1 && value[2] === 1;
const identityQuat = (value: Quat): boolean => value[0] === 0 && value[1] === 0 && value[2] === 0 && value[3] === 1;

/**
 * Layer values that change the resolved c2w. Ids and timestamps stay out.
 * An identity calibration, one-to-one mapping, and no tracking events return
 * undefined so a take with no stored layers hashes as before.
 */
export const cameraLayerRecord = (take: CameraTake): Record<string, unknown> | undefined => {
  const { calibration, mapping } = take;
  const events = [...take.trackingEvents].sort((left, right) => left.frame - right.frame || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
  const calibrationIdentity = calibration.method === "identity"
    && calibration.scale === 1
    && identityQuat(calibration.rotation)
    && zeroVec(calibration.translation)
    && calibration.residualRmsM === undefined;
  const mappingIdentity = mapping.mode === "one_to_one"
    && oneVec(mapping.translationGain)
    && mapping.rotationGain === 1
    && mapping.smoothing === 0
    && mapping.timeScale === 1
    && mapping.timeOffsetFrames === 0
    && (mapping.lossPolicy ?? "preserve") === "preserve"
    && mapping.applyDriftCorrection !== true;
  if (calibrationIdentity && mappingIdentity && events.length === 0) return undefined;
  return {
    calibration: {
      arFramework: calibration.arFramework,
      scale: calibration.scale,
      rotation: calibration.rotation,
      translation: calibration.translation,
      method: calibration.method,
      ...(calibration.residualRmsM !== undefined ? { residualRmsM: calibration.residualRmsM } : {}),
    },
    mapping: {
      mode: mapping.mode,
      translationGain: mapping.translationGain,
      rotationGain: mapping.rotationGain,
      smoothing: mapping.smoothing,
      timeScale: mapping.timeScale,
      timeOffsetFrames: mapping.timeOffsetFrames,
      lossPolicy: mapping.lossPolicy ?? "preserve",
      applyDriftCorrection: mapping.applyDriftCorrection === true,
    },
    trackingEvents: events.map((event) => ({
      kind: event.kind,
      frame: event.frame,
      ...(event.correction ? { correction: { translation: event.correction.translation, rotation: event.correction.rotation } } : {}),
      ...(event.estimatedDriftM !== undefined ? { estimatedDriftM: event.estimatedDriftM } : {}),
    })),
  };
};

export const upstreamPassRecord = (shot: Shot, spec: RenderPassSpec): Record<string, unknown> => {
  const take = selectedTake(shot);
  const layers = take ? cameraLayerRecord(take) : undefined;
  return {
    durationFrames: shot.time.durationFrames,
    subjects: shot.subjects.map(subjectContent),
    camera: {
      interpolation: shot.camera.interpolation,
      lens: lensRecord(shot.camera.lens),
      keys: take
        ? byFrame(take.keys).map((key) => ({
            frame: key.frame,
            position: key.position,
            rotation: key.rotation,
            focalLengthMm: key.focalLengthMm,
            ...(key.focusDistanceM !== undefined ? { focusDistanceM: key.focusDistanceM } : {}),
            ...(key.aperture !== undefined ? { aperture: key.aperture } : {}),
          }))
        : [],
      ...(layers ? { layers } : {}),
    },
    spec: { width: spec.width, height: spec.height, near: spec.near, far: spec.far },
  };
};

/** Parent pass hash. The same `computePassHash` the AOV digest uses. */
export const upstreamPassHash = (shot: Shot, spec: RenderPassSpec): string =>
  computePassHash(upstreamPassRecord(shot, spec));

/** ID → pixel value rows. Array order is persistent-id order, which the hash keeps. */
export const instanceMapRecord = (
  table: readonly InstanceIdEntry[],
): { persistentId: string; index: number; role: InstanceIdEntry["role"] }[] =>
  [...table]
    .sort((left, right) => (left.persistentId < right.persistentId ? -1 : left.persistentId > right.persistentId ? 1 : 0))
    .map((entry) => ({ persistentId: entry.persistentId, index: entry.index, role: entry.role }));

export const instanceMapHash = (table: readonly InstanceIdEntry[]): string =>
  computePassHash(instanceMapRecord(table));

export const renderPassHashInput = (
  shot: Shot,
  kind: RenderPassKind,
  context: HashContext,
  table: readonly InstanceIdEntry[],
): RenderPassHashInput => {
  const input: RenderPassHashInput = {
    assetRevision: { assetId: context.assetRevision.assetId, revisionId: context.assetRevision.revisionId },
    modelVersion: RENDERER_VERSION,
    seed: context.seed,
    passHash: upstreamPassHash(shot, context.spec),
    passKind: kind,
    frameRange: [context.frameRange.start, context.frameRange.end],
    fps: shot.time.fps,
  };
  if (kind === "instance_id") {
    input.instanceMapHash = instanceMapHash(table);
  }
  return input;
};

/** AOV cache key. One `computePassHash` call over `renderPassHashInput`. */
export const renderPassHash = (
  shot: Shot,
  kind: RenderPassKind,
  context: HashContext,
  table: readonly InstanceIdEntry[],
): string => computePassHash(renderPassHashInput(shot, kind, context, table));

export const renderPassHashes = (
  shot: Shot,
  context: HashContext,
  table: readonly InstanceIdEntry[],
): Record<RenderPassKind, string> => {
  const hashes = {} as Record<RenderPassKind, string>;
  for (const kind of RENDER_PASS_KINDS) {
    hashes[kind] = renderPassHash(shot, kind, context, table);
  }
  return hashes;
};
