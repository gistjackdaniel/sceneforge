import { z } from "zod";

export const voiceIntentSchema = z.object({
  /** move | rotate | scale | place | remove | pose | look-at | swap-location | camera */
  verb: z.enum([
    "move",
    "rotate",
    "scale",
    "place",
    "remove",
    "pose",
    "look-at",
    "swap-location",
    "camera",
  ]),
  /** Raw target references as spoken, e.g. ["the chair", "it"] */
  targetRefs: z.array(z.string()).default([]),
  /** Parameters extracted from text. Values are intentionally untyped for forward-compat. */
  params: z.record(z.any()).default({}),
  /** 0..1 confidence for the parser decision */
  confidence: z.number().min(0).max(1).default(1),
  /** Source locale hint, e.g., "ko" | "en". */
  locale: z.enum(["ko", "en"]).default("en"),
});

export type VoiceIntent = z.infer<typeof voiceIntentSchema>;

export interface IntentParser {
  /** Deterministic, non-LLM parser. Must not block rendering. */
  parse(input: { text: string; locale?: string }): VoiceIntent | undefined;
}

