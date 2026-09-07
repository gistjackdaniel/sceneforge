export type SensorPreset = "full-frame" | "super35" | "micro-four-thirds";

export interface LensParams {
  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;
  sensorPreset?: SensorPreset;
}

export const defaultLensParams = (): LensParams => ({
  focalLengthMm: 35,
  sensorPreset: "full-frame",
});

export const lensNodeIdForClip = (clipId: string): string => `node-${clipId}-lens`;

export const isLensParams = (value: unknown): value is LensParams => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.focalLengthMm === "number" || typeof record.focalLength === "number";
};

export const lensParamsFromNode = (parameters: Record<string, unknown>): LensParams => {
  const focal =
    typeof parameters.focalLengthMm === "number"
      ? parameters.focalLengthMm
      : typeof parameters.focalLength === "number"
        ? parameters.focalLength
        : 35;
  return {
    focalLengthMm: focal,
    focusDistanceM: typeof parameters.focusDistanceM === "number" ? parameters.focusDistanceM : undefined,
    aperture: typeof parameters.aperture === "number" ? parameters.aperture : undefined,
    sensorPreset:
      parameters.sensorPreset === "full-frame" ||
      parameters.sensorPreset === "super35" ||
      parameters.sensorPreset === "micro-four-thirds"
        ? parameters.sensorPreset
        : "full-frame",
  };
};

/** Through-the-lens vertical FOV in degrees. */
export const verticalFovFromLens = (lens: LensParams): number => {
  const sensorHeightMm =
    lens.sensorPreset === "super35" ? 13.5 : lens.sensorPreset === "micro-four-thirds" ? 13 : 24;
  const focal = Math.max(8, lens.focalLengthMm);
  return (2 * Math.atan(sensorHeightMm / 2 / focal) * 180) / Math.PI;
};
