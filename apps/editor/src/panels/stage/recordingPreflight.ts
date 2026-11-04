import { OUTPUT_ASPECT_PRESETS, type OutputAspectPreset } from "../../domain/rendering";

export const validateOutputAspect = (preset: OutputAspectPreset): boolean =>
  OUTPUT_ASPECT_PRESETS.some((item) => item.id === preset) &&
  ((): boolean => {
    const entry = OUTPUT_ASPECT_PRESETS.find((i) => i.id === preset)!;
    return entry.width > 0 && entry.height > 0;
  })();

