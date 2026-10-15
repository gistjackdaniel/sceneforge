import { z } from "zod";

// Optional, passthrough-only extension payload shapes for future v0.2.
// Not validated by default and not emitted unless present.

export const identityExtensionSchema = z.object({
  // Per-actor identity: face and voice references (opaque identifiers/URIs)
  actors: z
    .record(
      z.object({
        face_ref: z.string().min(1).optional(),
        voice_id: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

export const speechUtteranceSpanSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  text: z.string().min(1).optional(),
});

export const speechExtensionSchema = z.object({
  // Per-actor speech inputs: audio reference and utterance spans
  actors: z
    .record(
      z.object({
        audio_ref: z.string().min(1).optional(),
        utterances: z.array(speechUtteranceSpanSchema).optional(),
      }),
    )
    .optional(),
});

export const contactEventSchema = z.object({
  frame: z.number().int().min(0),
  source_part: z.string().min(1),
  target_part: z.string().min(1),
  impulse: z.number().optional(),
  direction: z.tuple([z.number(), z.number(), z.number()]).optional(),
});

export const contactEventsExtensionSchema = z.object({
  events: z.array(contactEventSchema).optional(),
});

export const renderSettingsExtensionSchema = z.object({
  mode: z.union([z.literal("preview"), z.literal("final")]).optional(),
});

