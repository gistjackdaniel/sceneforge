import * as THREE from "three";
import { EULER_ORDER } from "./euler";
import { multiplyQuat, rotateVec3, type Quat, type Vec3 } from "./cameraRotation";
import type { DeviceCalibration } from "./types";

export class CalibrationError extends Error {
  readonly name = "CalibrationError";

  constructor(message: string) {
    super(message);
  }
}

export type ScaleSpec =
  | { mode: "fixed"; scale: number }
  | { mode: "estimated"; knownLengthM: number; segmentDevice: readonly [Vec3, Vec3] };

type CalibrationBase = {
  framework: DeviceCalibration["arFramework"];
  calibrationId: string;
  createdAt: string;
  scale: ScaleSpec;
};

/** Floor points, or an explicit floor normal, plus the device point that becomes the scene origin. */
export type FloorCalibrationInput = CalibrationBase & {
  kind: "floor";
  originDevice: Vec3;
  sceneOrigin?: Vec3;
  floorPointsDevice?: readonly Vec3[];
  floorNormalDevice?: Vec3;
  /** Device-space direction that should land on scene +Z after the floor is level. */
  forwardDevice?: Vec3;
};

/** Two correspondences are yaw-only. Three can be a full rotation. */
export type PointCalibrationInput = CalibrationBase & {
  kind: "points";
  pairs: readonly { device: Vec3; scene: Vec3 }[];
  rotation: "yaw_only" | "full";
};

export type WorldCalibrationInput = FloorCalibrationInput | PointCalibrationInput;

const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (value: Vec3): number => Math.hypot(value[0], value[1], value[2]);
const scaleVec = (value: Vec3, factor: number): [number, number, number] => [value[0] * factor, value[1] * factor, value[2] * factor];

const unit = (value: Vec3): [number, number, number] => {
  const magnitude = length(value);
  if (magnitude < 1e-10) throw new CalibrationError("A calibration direction is degenerate.");
  return scaleVec(value, 1 / magnitude);
};

const yawQuaternion = (yaw: number): [number, number, number, number] => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, EULER_ORDER));
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const quaternionFromMatrix = (columns: readonly [Vec3, Vec3, Vec3]): [number, number, number, number] => {
  const matrix = new THREE.Matrix4().set(
    columns[0][0], columns[1][0], columns[2][0], 0,
    columns[0][1], columns[1][1], columns[2][1], 0,
    columns[0][2], columns[1][2], columns[2][2], 0,
    0, 0, 0, 1,
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const applySimilarity = (scale: number, rotation: Quat, translation: Vec3, point: Vec3): [number, number, number] =>
  add(scaleVec(rotateVec3(rotation, point), scale), translation);

const rms = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
};

const fixedOrSegmentScale = (spec: ScaleSpec): number => {
  if (spec.mode === "fixed") {
    if (!(spec.scale > 0)) throw new CalibrationError("Scale must be positive.");
    return spec.scale;
  }
  const span = length(sub(spec.segmentDevice[1], spec.segmentDevice[0]));
  if (!(spec.knownLengthM > 0) || span < 1e-10) throw new CalibrationError("Scale needs a measured length.");
  return spec.knownLengthM / span;
};

/**
 * Symmetric 3×3 Jacobi. Returns eigenvalues and eigenvectors as columns.
 * Used for the floor plane. A wrong normal shows up as residual, not a thrown error.
 */
const jacobi3 = (matrix: number[][]): { values: number[]; vectors: [Vec3, Vec3, Vec3] } => {
  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 16; sweep += 1) {
    let largest = 0;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p]?.[q] ?? 0;
        if (Math.abs(apq) <= largest) continue;
        largest = Math.abs(apq);
        const app = a[p]?.[p] ?? 0;
        const aqq = a[q]?.[q] ?? 0;
        const tau = (aqq - app) / (2 * apq);
        const tangent = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const cosine = 1 / Math.sqrt(1 + tangent * tangent);
        const sine = tangent * cosine;
        if (a[p]) a[p][p] = app - tangent * apq;
        if (a[q]) a[q][q] = aqq + tangent * apq;
        if (a[p]) a[p][q] = 0;
        if (a[q]) a[q][p] = 0;
        for (let row = 0; row < 3; row += 1) {
          if (row === p || row === q) continue;
          const arp = a[row]?.[p] ?? 0;
          const arq = a[row]?.[q] ?? 0;
          const nextP = cosine * arp - sine * arq;
          const nextQ = sine * arp + cosine * arq;
          if (a[row]) {
            a[row][p] = nextP;
            a[row][q] = nextQ;
          }
          if (a[p]) a[p][row] = nextP;
          if (a[q]) a[q][row] = nextQ;
        }
        for (let row = 0; row < 3; row += 1) {
          const vrp = v[row]?.[p] ?? 0;
          const vrq = v[row]?.[q] ?? 0;
          if (v[row]) {
            v[row][p] = cosine * vrp - sine * vrq;
            v[row][q] = sine * vrp + cosine * vrq;
          }
        }
      }
    }
    if (largest < 1e-14) break;
  }
  const vectors: [Vec3, Vec3, Vec3] = [
    [v[0]?.[0] ?? 1, v[1]?.[0] ?? 0, v[2]?.[0] ?? 0],
    [v[0]?.[1] ?? 0, v[1]?.[1] ?? 1, v[2]?.[1] ?? 0],
    [v[0]?.[2] ?? 0, v[1]?.[2] ?? 0, v[2]?.[2] ?? 1],
  ];
  return { values: [a[0]?.[0] ?? 0, a[1]?.[1] ?? 0, a[2]?.[2] ?? 0], vectors };
};

const fitNormal = (points: readonly Vec3[]): [number, number, number] => {
  if (points.length < 3) throw new CalibrationError("A floor needs at least three points.");
  if (points.length === 3) {
    const first = points[0];
    const second = points[1];
    const third = points[2];
    if (!first || !second || !third) throw new CalibrationError("A floor needs at least three points.");
    const normal = cross(sub(second, first), sub(third, first));
    if (length(normal) < 1e-10) throw new CalibrationError("Floor points do not define a plane.");
    const directed = unit(normal);
    return directed[1] < 0 ? scaleVec(directed, -1) : directed;
  }
  const centroid = points.reduce((sum, point) => add(sum, point), [0, 0, 0] as [number, number, number]);
  const center = scaleVec(centroid, 1 / points.length);
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const point of points) {
    const delta = sub(point, center);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const cell = covariance[row];
        if (cell) cell[col] = (cell[col] ?? 0) + (delta[row] ?? 0) * (delta[col] ?? 0);
      }
    }
  }
  const eigen = jacobi3(covariance);
  let smallest = 0;
  eigen.values.forEach((value, index) => {
    if (value < (eigen.values[smallest] ?? 0)) smallest = index;
  });
  const sorted = [...eigen.values].sort((left, right) => left - right);
  if ((sorted[1] ?? 0) < 1e-10) throw new CalibrationError("Floor points do not define a plane.");
  const normal = unit(eigen.vectors[smallest] ?? [0, 1, 0]);
  return normal[1] < 0 ? scaleVec(normal, -1) : normal;
};

const levelAndYaw = (normal: Vec3, forward: Vec3 | undefined): [number, number, number, number] => {
  const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normal), new THREE.Vector3(0, 1, 0));
  const level: [number, number, number, number] = [up.x, up.y, up.z, up.w];
  if (!forward) return level;
  const leveled = rotateVec3(level, forward);
  const horizontal = Math.hypot(leveled[0], leveled[2]);
  if (horizontal < 1e-10) return level;
  const yaw = Math.atan2(leveled[0], leveled[2]);
  return multiplyQuat(yawQuaternion(-yaw), level);
};

const result = (
  input: CalibrationBase,
  method: DeviceCalibration["method"],
  scale: number,
  rotation: Quat,
  translation: Vec3,
  residualRmsM: number,
): DeviceCalibration => ({
  calibrationId: input.calibrationId,
  arFramework: input.framework,
  scale,
  rotation,
  translation,
  method,
  residualRmsM,
  createdAt: input.createdAt,
});

const solveFloor = (input: FloorCalibrationInput): DeviceCalibration => {
  const sceneOrigin = input.sceneOrigin ?? [0, 0, 0];
  const normal = input.floorPointsDevice && input.floorPointsDevice.length >= 3
    ? fitNormal(input.floorPointsDevice)
    : input.floorNormalDevice
      ? unit(input.floorNormalDevice)
      : undefined;
  if (!normal) throw new CalibrationError("A floor needs a normal or at least three points.");
  const scale = fixedOrSegmentScale(input.scale);
  const rotation = levelAndYaw(normal, input.forwardDevice);
  const translation = sub(sceneOrigin, scaleVec(rotateVec3(rotation, input.originDevice), scale));
  const floor = input.floorPointsDevice ?? [];
  const residualRmsM = floor.length === 0
    ? 0
    : rms(floor.map((point) => applySimilarity(scale, rotation, translation, point)[1] - sceneOrigin[1]));
  const method = input.floorPointsDevice && input.floorPointsDevice.length >= 3 ? "plane_fit" : "manual_anchor";
  return result(input, method, scale, rotation, translation, residualRmsM);
};

const centroidOf = (points: readonly Vec3[]): [number, number, number] =>
  scaleVec(points.reduce((sum, point) => add(sum, point), [0, 0, 0] as [number, number, number]), 1 / points.length);

const solveYaw = (input: PointCalibrationInput, scale: number): { rotation: Quat; translation: [number, number, number] } => {
  const device = input.pairs.map((pair) => pair.device);
  const scene = input.pairs.map((pair) => pair.scene);
  const deviceCenter = centroidOf(device);
  const sceneCenter = centroidOf(scene);
  let cosine = 0;
  let sine = 0;
  input.pairs.forEach((pair) => {
    const ax = pair.device[0] - deviceCenter[0];
    const az = pair.device[2] - deviceCenter[2];
    const bx = pair.scene[0] - sceneCenter[0];
    const bz = pair.scene[2] - sceneCenter[2];
    cosine += ax * bx + az * bz;
    sine += az * bx - ax * bz;
  });
  const rotation = yawQuaternion(Math.atan2(sine, cosine));
  const translation = sub(sceneCenter, scaleVec(rotateVec3(rotation, deviceCenter), scale));
  return { rotation, translation };
};

const frameOf = (points: readonly [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] => {
  const x = unit(sub(points[1], points[0]));
  const normal = unit(cross(x, sub(points[2], points[0])));
  const y = cross(normal, x);
  return [x, y, normal];
};

const solveFull = (pairs: readonly { device: Vec3; scene: Vec3 }[], scale: number): { rotation: Quat; translation: [number, number, number] } => {
  const first = pairs[0];
  const second = pairs[1];
  const third = pairs[2];
  if (!first || !second || !third) throw new CalibrationError("A full rotation needs three correspondences.");
  const deviceFrame = frameOf([first.device, second.device, third.device]);
  const sceneFrame = frameOf([first.scene, second.scene, third.scene]);
  const rotation = quaternionFromMatrix([
    [
      (sceneFrame[0][0] * deviceFrame[0][0]) + (sceneFrame[1][0] * deviceFrame[1][0]) + (sceneFrame[2][0] * deviceFrame[2][0]),
      (sceneFrame[0][1] * deviceFrame[0][0]) + (sceneFrame[1][1] * deviceFrame[1][0]) + (sceneFrame[2][1] * deviceFrame[2][0]),
      (sceneFrame[0][2] * deviceFrame[0][0]) + (sceneFrame[1][2] * deviceFrame[1][0]) + (sceneFrame[2][2] * deviceFrame[2][0]),
    ],
    [
      (sceneFrame[0][0] * deviceFrame[0][1]) + (sceneFrame[1][0] * deviceFrame[1][1]) + (sceneFrame[2][0] * deviceFrame[2][1]),
      (sceneFrame[0][1] * deviceFrame[0][1]) + (sceneFrame[1][1] * deviceFrame[1][1]) + (sceneFrame[2][1] * deviceFrame[2][1]),
      (sceneFrame[0][2] * deviceFrame[0][1]) + (sceneFrame[1][2] * deviceFrame[1][1]) + (sceneFrame[2][2] * deviceFrame[2][1]),
    ],
    [
      (sceneFrame[0][0] * deviceFrame[0][2]) + (sceneFrame[1][0] * deviceFrame[1][2]) + (sceneFrame[2][0] * deviceFrame[2][2]),
      (sceneFrame[0][1] * deviceFrame[0][2]) + (sceneFrame[1][1] * deviceFrame[1][2]) + (sceneFrame[2][1] * deviceFrame[2][2]),
      (sceneFrame[0][2] * deviceFrame[0][2]) + (sceneFrame[1][2] * deviceFrame[1][2]) + (sceneFrame[2][2] * deviceFrame[2][2]),
    ],
  ]);
  const deviceCenter = centroidOf(pairs.map((pair) => pair.device));
  const sceneCenter = centroidOf(pairs.map((pair) => pair.scene));
  const translation = sub(sceneCenter, scaleVec(rotateVec3(rotation, deviceCenter), scale));
  return { rotation, translation };
};

const pointScale = (input: PointCalibrationInput): number => {
  if (input.scale.mode === "fixed") return fixedOrSegmentScale(input.scale);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < input.pairs.length; index += 1) {
    for (let other = index + 1; other < input.pairs.length; other += 1) {
      const left = input.pairs[index];
      const right = input.pairs[other];
      if (!left || !right) continue;
      numerator += length(sub(left.scene, right.scene)) ** 2;
      denominator += length(sub(left.device, right.device)) ** 2;
    }
  }
  if (denominator < 1e-12) throw new CalibrationError("Scale needs separated points.");
  return Math.sqrt(numerator / denominator);
};

const solvePoints = (input: PointCalibrationInput): DeviceCalibration => {
  if (input.pairs.length < 2 || input.pairs.length > 3) {
    throw new CalibrationError("Point calibration needs 2 or 3 correspondences.");
  }
  if (input.rotation === "full" && input.pairs.length < 3) {
    throw new CalibrationError("A full rotation needs three correspondences.");
  }
  const scale = pointScale(input);
  const solved = input.rotation === "full" ? solveFull(input.pairs, scale) : solveYaw(input, scale);
  const residualRmsM = rms(input.pairs.map((pair) => length(sub(
    applySimilarity(scale, solved.rotation, solved.translation, pair.device),
    pair.scene,
  ))));
  return result(input, "marker", scale, solved.rotation, solved.translation, residualRmsM);
};

/**
 * Device world → scene world similarity.
 * The returned calibration is a layer. It does not rewrite the track it was solved from.
 * Floor alignment is `plane_fit` (or `manual_anchor` when the normal is given).
 * Point pairs are `marker`. Residual is meters, RMS.
 */
export const solveWorldCalibration = (input: WorldCalibrationInput): DeviceCalibration =>
  input.kind === "floor" ? solveFloor(input) : solvePoints(input);
