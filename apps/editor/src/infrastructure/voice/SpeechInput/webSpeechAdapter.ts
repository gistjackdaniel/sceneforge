import type { SpeechInput, SpeechSegment } from "../../../application/ports/SpeechInput";

type WebSpeechRecognition = typeof window extends { webkitSpeechRecognition: infer T } ? T : never;

export const createWebSpeechInput = (): SpeechInput | undefined => {
  if (typeof window === "undefined") return undefined;
  const RecognitionCtor: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
  if (!RecognitionCtor) return undefined;

  const recognition: any = new RecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  const subs = new Set<(segment: SpeechSegment) => void>();
  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const text = res[0].transcript;
      subs.forEach((cb) =>
        cb({
          text,
          isFinal: res.isFinal === true,
          confidence: typeof res[0].confidence === "number" ? res[0].confidence : undefined,
          locale: recognition.lang?.startsWith("ko") ? "ko" : "en",
        }),
      );
    }
  };
  recognition.onerror = () => {
    // Emit nothing; UI should fall back to typed console
  };

  return {
    start() {
      try {
        recognition.start();
      } catch {
        // no-op
      }
    },
    stop() {
      try {
        recognition.stop();
      } catch {
        // no-op
      }
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
};

