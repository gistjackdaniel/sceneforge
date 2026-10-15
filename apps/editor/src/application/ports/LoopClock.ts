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

export interface LoopClock {
<<<<<<< HEAD
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
=======
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
>>>>>>> origin/cursor/camera-gizmo-keyframes-backbone-35fe
    }
  };

  const start = () => {
    if (playing) return;
    playing = true;
<<<<<<< HEAD
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
=======
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
>>>>>>> origin/cursor/camera-gizmo-keyframes-backbone-35fe
  };
};

