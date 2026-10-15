import type { SpeechInput, SpeechSegment } from "../../../application/ports/SpeechInput";

/**
 * Fallback adapter for environments without microphone/STT.
 * Consumers can programmatically push text via `emit(text, { final })`.
 */
export const createTypedTextSpeechInput = (options?: { defaultLocale?: string }) => {
  let running = false;
  const subs = new Set<(segment: SpeechSegment) => void>();

  const emit = (text: string, { isFinal = true, confidence = 1, locale }: Partial<Omit<SpeechSegment, "text">> = {}) => {
    const payload: SpeechSegment = {
      text,
      isFinal,
      confidence,
      locale: locale ?? options?.defaultLocale ?? "en",
    };
    subs.forEach((cb) => cb(payload));
  };

  const input: SpeechInput & { emit: typeof emit; isRunning: () => boolean } = {
    start() {
      running = true;
    },
    stop() {
      running = false;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit,
    isRunning: () => running,
  };
  return input;
};

