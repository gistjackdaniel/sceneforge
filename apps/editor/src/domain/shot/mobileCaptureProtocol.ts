import { z } from "zod";

export const MOBILE_CAMERA_API = "/api/mobile-camera";
export const MOBILE_CAMERA_PAGE = "/mobile-camera.html";
export const MOBILE_TAKE_MAX_BYTES = 8 * 1024 * 1024;

export const mobilePairCodeSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const mobilePairSettingsSchema = z.object({
  fps: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
});
export const mobilePairSchema = z.object({
  code: mobilePairCodeSchema,
  editorKey: mobilePairCodeSchema,
  settings: mobilePairSettingsSchema,
});

export type MobilePair = z.infer<typeof mobilePairSchema>;
export type MobilePairSettings = z.infer<typeof mobilePairSettingsSchema>;
