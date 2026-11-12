/**
 * Speech-to-text boundary for the speech2motion producer.
 * The only implementation here accepts text. It does not call a speech model.
 */

export type AsrLocale = "ko" | "en";

export type AsrTranscript = {
  text: string;
  locale: AsrLocale;
  isFinal: true;
  confidence: 1;
};

export type AsrFailure = "empty" | "audio_unsupported";

export type AsrResult = { ok: true; transcript: AsrTranscript } | { ok: false; reason: AsrFailure };

export type AsrRequest = {
  /** Typed utterance. This is the only input the stub understands. */
  text?: string;
  locale?: AsrLocale;
  /**
   * Present when a caller has audio bytes. The stub refuses them.
   * A speech model must not be added behind this field.
   */
  audio?: unknown;
};

export interface AsrEngine {
  transcribe(input: AsrRequest): AsrResult;
}

const localeOf = (text: string, requested: AsrLocale | undefined): AsrLocale => {
  if (requested) return requested;
  return /[ㄱ-ㅎ가-힣]/.test(text) ? "ko" : "en";
};

/** Text entry. Audio without a transcript is rejected and is not transcribed. */
export const createTextAsrStub = (): AsrEngine => ({
  transcribe(input) {
    const text = input.text?.trim() ?? "";
    if (!text) return { ok: false, reason: input.audio === undefined ? "empty" : "audio_unsupported" };
    return {
      ok: true,
      transcript: { text, locale: localeOf(text, input.locale), isFinal: true, confidence: 1 },
    };
  },
});
