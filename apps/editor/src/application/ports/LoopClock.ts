export interface LoopClock {
  /** Current loop time in seconds on the same timeline as camera keyframe t. */
  getTime(): number;
  /** Loop duration in seconds. */
  duration: number;
  /** Whether the loop is actively playing (non-blocking). */
  isPlaying: boolean;
  /**
   * Subscribe to time updates (seconds). Returns an unsubscribe function.
   * The callback MUST be called on every tick while playing without pausing the loop.
   */
  subscribe(callback: (tSeconds: number) => void): () => void;
}

export const createManualLoopClock = (initialDurationSeconds = 5): LoopClock & {
  setPlaying(value: boolean): void;
  setTime(tSeconds: number): void;
  setDuration(seconds: number): void;
} => {
  let t = 0;
  let duration = Math.max(0.0001, initialDurationSeconds);
  let playing = false;
  let rafId: number | undefined;
  const subscribers = new Set<(t: number) => void>();
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
  let startMs = now();

  const tick = () => {
    if (!playing) {
      return;
    }
    const elapsed = (now() - startMs) / 1000;
    t = elapsed % duration;
    subscribers.forEach((cb) => cb(t));
    // Schedule next micro tick (requestAnimationFrame in browser; setTimeout for tests)
    if (typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(tick);
    } else {
      // Node/Vitest fallback
      rafId = setTimeout(tick, 16) as unknown as number;
    }
  };

  const start = () => {
    if (playing) return;
    playing = true;
    startMs = now() - t * 1000;
    tick();
  };
  const stop = () => {
    playing = false;
    if (typeof cancelAnimationFrame !== "undefined" && typeof rafId === "number") {
      cancelAnimationFrame(rafId);
    } else if (typeof rafId === "number") {
      clearTimeout(rafId as unknown as NodeJS.Timeout);
    }
    rafId = undefined;
  };

  return {
    getTime: () => t,
    get duration() {
      return duration;
    },
    get isPlaying() {
      return playing;
    },
    subscribe(callback: (tSeconds: number) => void) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    setPlaying(value: boolean) {
      if (value) start();
      else stop();
    },
    setTime(tSeconds: number) {
      t = Math.max(0, Math.min(duration, tSeconds));
      startMs = now() - t * 1000;
      subscribers.forEach((cb) => cb(t));
    },
    setDuration(seconds: number) {
      duration = Math.max(0.0001, seconds);
      if (t > duration) {
        t = duration;
      }
      subscribers.forEach((cb) => cb(t));
    },
  };
};

