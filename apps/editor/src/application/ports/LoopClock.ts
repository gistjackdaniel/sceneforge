export interface LoopClock {
  /** Seconds progressed within the loop [0, duration). */
  getTime(): number;
  /** Loop duration in seconds. */
  duration: number;
  /** Whether the clock is actively ticking. */
  isPlaying: boolean;
  /** Subscribe to time updates; returns unsubscribe. */
  subscribe(cb: (t: number) => void): () => void;
}

export type CreateLoopClockOptions = {
  /** Loop duration in seconds. */
  duration: number;
  /** Target fps; used to throttle callbacks. Default 24. */
  fps?: number;
  /** Start immediately. Default true. */
  autoplay?: boolean;
};

/**
 * Real-time loop clock. Uses rAF; falls back to setTimeout when rAF is unavailable.
 * Subscribers are called at most once per frame (target fps).
 */
export const createLoopClock = (options: CreateLoopClockOptions): LoopClock & { start(): void; stop(): void } => {
  const duration = Math.max(0.001, options.duration);
  const fps = Math.max(1, Math.floor(options.fps ?? 24));
  const frameInterval = 1000 / fps;
  let playing = Boolean(options.autoplay ?? true);
  let lastTick = typeof performance !== "undefined" ? performance.now() : Date.now();
  let acc = 0; // milliseconds within loop
  const listeners = new Set<(t: number) => void>();
  let rafId = 0 as number | any;
  let timeoutId: any = null;

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const notify = () => {
    const tSec = (acc / 1000) % duration;
    listeners.forEach((cb) => cb(tSec));
  };

  const loop = () => {
    if (!playing) return;
    const now = nowMs();
    const delta = now - lastTick;
    if (delta >= frameInterval - 0.5) {
      lastTick = now;
      acc = (acc + delta) % (duration * 1000);
      notify();
    }
    if (typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(loop);
    } else {
      timeoutId = setTimeout(loop, frameInterval);
    }
  };

  const start = () => {
    if (playing) return;
    playing = true;
    lastTick = nowMs();
    if (typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(loop);
    } else {
      timeoutId = setTimeout(loop, frameInterval);
    }
  };

  const stop = () => {
    playing = false;
    if (typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // Kick off
  if (playing) {
    if (typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(loop);
    } else {
      timeoutId = setTimeout(loop, frameInterval);
    }
  }

  return {
    getTime: () => (acc / 1000) % duration,
    duration,
    get isPlaying() {
      return playing;
    },
    subscribe: (cb: (t: number) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    start,
    stop,
  };
};

