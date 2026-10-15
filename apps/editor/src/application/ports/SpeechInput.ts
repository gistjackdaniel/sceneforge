export interface SpeechSegment {
  /** Raw transcript text in source language. */
  text: string;
  /** ISO locale hint, e.g., "ko-KR" or "en-US". */
  locale?: string;
  /** 0..1 confidence if the engine provides it. */
  confidence?: number;
  /** Whether this segment is the final result for the current utterance. */
  isFinal: boolean;
}

export interface SpeechInput {
  /** Begin capturing speech (or accepting typed text for the fallback). */
  start(): Promise<void> | void;
  /** Stop capturing speech. */
  stop(): Promise<void> | void;
  /**
   * Subscribe to partial/final transcripts. Returns an unsubscribe function.
   * Implementations MUST emit partials (isFinal=false) when possible, and one final (isFinal=true).
   */
  subscribe(callback: (segment: SpeechSegment) => void): () => void;
}

