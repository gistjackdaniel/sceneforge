import { z } from "zod";

export const MOBILE_CAMERA_API = "/api/mobile-camera";
export const MOBILE_CAMERA_PAGE = "/mobile-camera.html";
export const MOBILE_TAKE_MAX_BYTES = 8 * 1024 * 1024;

export const mobilePairCodeSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const mobilePairSettingsSchema = z.object({
  fps: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
});
export const mobilePairRequestSchema = mobilePairSettingsSchema.extend({
  transport: z.enum(["qr", "usb"]).default("usb"),
});
const mobilePairBaseSchema = z.object({
  code: mobilePairCodeSchema,
  editorKey: mobilePairCodeSchema,
  settings: mobilePairSettingsSchema,
});
export const mobilePairSchema = z.discriminatedUnion("transport", [
  mobilePairBaseSchema.extend({ transport: z.literal("qr"), phoneOrigin: z.url({ protocol: /^https$/ }) }),
  mobilePairBaseSchema.extend({ transport: z.literal("usb") }),
]);

export type MobilePair = z.infer<typeof mobilePairSchema>;
export type MobilePairSettings = z.infer<typeof mobilePairSettingsSchema>;
export type MobilePairTransport = MobilePair["transport"];
