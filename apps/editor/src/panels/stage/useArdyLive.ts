import { useEffect, useRef, useState, type RefObject } from "react";
import { saveArdyClip, startArdy, stepArdy, stopArdy } from "../../application/services/ardyStream";
import { placeSomaSample } from "../../domain/sceneAuthoring/sampleTimelineMotion";
import { ARDY_SOMA_MODEL, KIMODO_FPS, KIMODO_MAX_FRAMES, KIMODO_MIN_SEGMENT_FRAMES, sampleSomaMotion, somaHeading, type SomaMotion } from "../../domain/sceneAuthoring/somaMotion";
import type { MotionSource } from "../../domain/shot/motionConditions";
import { sampleSubjectPose } from "../../domain/shot/queries";
import type { PosedSubject, Transform } from "../../domain/shot/types";
import type { ViewportActorMotion } from "../../presentation/viewport/actorMotionBinding";

/** Ask for the next window when less than a second is left to play. */
const REFILL_FRAMES = 30;
const START_SPEED = 0.6;
const SPEED_STEP = 0.2;
const MAX_SPEED = 2.4;
const TURN = Math.PI / 6;

/** Speed in metres per second, and direction in radians from the way the actor faced when steering began; positive turns left. */
export type Steering = { speed: number; angle: number };
export type SteerKey = "faster" | "slower" | "left" | "right";
/** While live, `keep` is how many of the latest frames a save puts into the shot. */
export type ArdyStatus =
  | { kind: "off" | "starting" | "saving" }
  | { kind: "live"; keep: number }
  | { kind: "error"; message: string };
export type LiveMotion = { subjectId: string; pose: ViewportActorMotion };

type Session = {
  subjectId: string;
  placement: Transform;
  startFrame: number;
  prompt: string;
  keep: number;
  motion: SomaMotion;
  cursor: number;
  pending: boolean;
  dirty: boolean;
  abort: AbortController;
};

/** The steering after one arrow key: ↑ starts walking or speeds up, ↓ slows to a stop, ← and → turn 30°. */
export const nextSteering = ({ speed, angle }: Steering, key: SteerKey): Steering => {
  if (key === "left" || key === "right") return { speed, angle: angle + (key === "left" ? TURN : -TURN) };
  if (key === "faster") return { speed: speed < SPEED_STEP / 2 ? START_SPEED : Math.min(MAX_SPEED, speed + SPEED_STEP), angle };
  const slower = speed - SPEED_STEP;
  return { speed: slower < SPEED_STEP / 2 ? 0 : slower, angle };
};

/**
 * Steer one actor with ARDY: play its frames at 30 fps, replan whenever steering changes or less than a second is
 * buffered, and publish the placed pose through `live` for the viewport to read each animation frame.
 */
export const useArdyLive = (live: RefObject<LiveMotion | null>) => {
  const [status, setStatus] = useState<ArdyStatus>({ kind: "off" });
  const [steering, setSteering] = useState<Steering>({ speed: 0, angle: 0 });
  const session = useRef<Session | undefined>(undefined);
  const starting = useRef<AbortController | undefined>(undefined);
  const steerRef = useRef(steering);
  steerRef.current = steering;

  const fail = (message: string) => {
    session.current?.abort.abort();
    session.current = undefined;
    live.current = null;
    void stopArdy();
    setStatus({ kind: "error", message });
  };

  // ARDY's own frame: heading 0 faces +Z, so the actor's starting facing is the first frame's heading.
  const velocity = (current: Session): [number, number] => {
    const { speed, angle } = steerRef.current;
    const direction = somaHeading(current.motion.frames[0]) + angle;
    return [Math.sin(direction) * speed, Math.cos(direction) * speed];
  };

  const refill = async (current: Session) => {
    if (current.pending) return;
    current.pending = true;
    current.dirty = false;
    try {
      const chunk = await stepArdy(Math.floor(current.cursor), velocity(current), current.prompt, current.abort.signal);
      if (session.current !== current) return;
      current.motion = { ...current.motion, frames: [...current.motion.frames.slice(0, chunk.start), ...chunk.frames] };
    } catch (cause) {
      if (!current.abort.signal.aborted) fail(cause instanceof Error ? cause.message : "ARDY 실시간 조종이 멈췄습니다.");
    } finally {
      current.pending = false;
    }
  };

  useEffect(() => {
    if (status.kind !== "live") return;
    let frame = 0;
    let last = performance.now();
    const play = (now: number) => {
      const current = session.current;
      if (!current) return;
      current.cursor = Math.min(current.cursor + ((now - last) / 1000) * KIMODO_FPS, current.motion.frames.length - 1);
      last = now;
      live.current = {
        subjectId: current.subjectId,
        pose: placeSomaSample(current.placement, current.motion, sampleSomaMotion(current.motion, current.cursor / KIMODO_FPS)),
      };
      if (current.dirty || current.motion.frames.length - 1 - current.cursor < REFILL_FRAMES) void refill(current);
      frame = requestAnimationFrame(play);
    };
    frame = requestAnimationFrame(play);
    return () => cancelAnimationFrame(frame);
  }, [status.kind, live]);

  useEffect(() => () => {
    starting.current?.abort();
    session.current?.abort.abort();
    if (starting.current || session.current) void stopArdy();
  }, []);

  return {
    status,
    steering,
    /** Steer `subject` from `startFrame`; `room` is how many 30 fps frames fit in the shot from there. */
    async start(subject: PosedSubject, startFrame: number, prompt: string, room: number) {
      starting.current?.abort();
      session.current?.abort.abort();
      session.current = undefined;
      const abort = new AbortController();
      starting.current = abort;
      setStatus({ kind: "starting" });
      setSteering({ speed: 0, angle: 0 });
      try {
        const text = prompt.trim() || "A person walks.";
        const { skeleton, chunk } = await startArdy(text, abort.signal);
        const motion: SomaMotion = { schemaVersion: 1, model: ARDY_SOMA_MODEL, prompt: text, seed: 0, fps: KIMODO_FPS, ...skeleton, frames: chunk.frames };
        const keep = Math.max(0, Math.min(Math.floor(room), KIMODO_MAX_FRAMES));
        session.current = {
          subjectId: subject.id, placement: sampleSubjectPose(subject, startFrame), startFrame, prompt: text, keep,
          motion, cursor: 0, pending: false, dirty: true, abort,
        };
        setStatus({ kind: "live", keep });
      } catch (cause) {
        if (!abort.signal.aborted) fail(cause instanceof Error ? cause.message : "ARDY를 시작하지 못했습니다.");
      } finally {
        if (starting.current === abort) starting.current = undefined;
      }
    },
    steer(key: SteerKey) {
      const next = nextSteering(steerRef.current, key);
      steerRef.current = next;
      setSteering(next);
      if (session.current) session.current.dirty = true;
    },
    /**
     * End steering. With `save`, keep the latest frames that fit in the shot as a clip, placed from the start frame,
     * so the steering just performed is what the shot replays.
     */
    async stop(save: boolean): Promise<{ subjectId: string; source: MotionSource; startFrame: number; frames: number } | undefined> {
      const current = session.current;
      session.current = undefined;
      live.current = null;
      if (starting.current) {
        starting.current.abort();
        starting.current = undefined;
        void stopArdy();
        setStatus({ kind: "off" });
      }
      if (!current) return undefined;
      current.abort.abort();
      const to = Math.floor(current.cursor) + 1;
      const from = Math.max(0, to - current.keep);
      try {
        if (!save) return undefined;
        if (to - from < KIMODO_MIN_SEGMENT_FRAMES) throw new Error("샷에 넣을 모션이 0.5초보다 짧습니다.");
        setStatus({ kind: "saving" });
        const source = await saveArdyClip(from, to);
        return { subjectId: current.subjectId, source, startFrame: current.startFrame, frames: to - from };
      } catch (cause) {
        setStatus({ kind: "error", message: cause instanceof Error ? cause.message : "실시간 모션을 저장하지 못했습니다." });
        return undefined;
      } finally {
        void stopArdy();
        setStatus((previous) => previous.kind === "error" ? previous : { kind: "off" });
      }
    },
  };
};
