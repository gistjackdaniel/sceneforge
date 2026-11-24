export type Vec3 = readonly [number, number, number];

const length = (value: Vec3): number => Math.hypot(value[0], value[1], value[2]);

const scale = (value: Vec3, factor: number): [number, number, number] => [
  value[0] * factor,
  value[1] * factor,
  value[2] * factor,
];

const add = (left: Vec3, right: Vec3): [number, number, number] => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

const dot = (left: Vec3, right: Vec3): number => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const cross = (left: Vec3, right: Vec3): [number, number, number] => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const unit = (value: Vec3): [number, number, number] | undefined => {
  const span = length(value);
  if (span < 1e-8) return undefined;
  return scale(value, 1 / span);
};

/**
 * Two-bone reach with the shoulder at the origin.
 * The wrist lands on `target` when the distance is between `|upper - lower|` and `upper + lower`.
 * Outside that range the arm stays at full fold or full extension along the target.
 * The elbow bends toward `pole`. Segment lengths stay `upper` and `lower`.
 * No scene access and no mutation of the inputs.
 */
export const solveTwoBone = (
  upper: number,
  lower: number,
  target: Vec3,
  pole: Vec3 = [0, 0, 1],
): { elbow: [number, number, number]; wrist: [number, number, number] } => {
  const direction = unit(target) ?? [0, -1, 0];
  const maxReach = upper + lower;
  const minReach = Math.abs(upper - lower);
  const reach = Math.min(maxReach, Math.max(minReach, length(target)));
  const wrist = scale(direction, reach);
  let poleDir = unit(pole) ?? [0, 0, 1];
  if (Math.abs(dot(direction, poleDir)) > 0.999) {
    poleDir = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  }
  const plane = unit(cross(direction, poleDir)) ?? [1, 0, 0];
  const bend = unit(cross(plane, direction)) ?? poleDir;
  const rawCosine = (upper * upper + reach * reach - lower * lower) / (2 * upper * Math.max(reach, 1e-8));
  const cosine = Math.abs(rawCosine) >= 1 - 1e-8 ? Math.sign(rawCosine) : Math.min(1, Math.max(-1, rawCosine));
  const sine = Math.abs(cosine) === 1 ? 0 : Math.sqrt(Math.max(0, 1 - cosine * cosine));
  return {
    elbow: add(scale(direction, cosine * upper), scale(bend, sine * upper)),
    wrist,
  };
};
