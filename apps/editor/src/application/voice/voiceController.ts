import type { SpeechInput } from "../ports/SpeechInput";
import type { IntentParser, VoiceIntent } from "../ports/IntentParser";
import type { TargetResolver } from "../ports/TargetResolver";
import type { LoopClock } from "../ports/LoopClock";
import type { DomainCommand } from "../commands/types";
import type { Project } from "../../domain/project/types";
import { mapVoiceIntentToCommands } from "./intentToCommands";

export interface VoiceControllerDeps {
  speech: SpeechInput;
  parser: IntentParser;
  resolver: TargetResolver;
  clock: LoopClock;
  dispatchCommands: (commands: DomainCommand[], logMessage?: string) => void;
  getContext: () => {
    project: Project;
    clipId: string | undefined;
    selectionIds?: string[];
    locale?: "ko" | "en";
    fps?: number;
  };
}

export const createVoiceController = (deps: VoiceControllerDeps) => {
  const { speech, parser, resolver, clock, dispatchCommands, getContext } = deps;
  let lastPartial: VoiceIntent | undefined;

  const unsubscribeClock = clock.subscribe(() => {
    // no-op: ensure we never pause the loop
  });

  const unsubscribeSpeech = speech.subscribe((segment) => {
    const { project, clipId, selectionIds, locale, fps } = getContext();
    if (!clipId) {
      return;
    }
    const intent = parser.parse({ text: segment.text, locale });
    if (!intent) return;
    const candidates =
      intent.targetRefs.length > 0
        ? resolver.resolve(intent.targetRefs[0], { selectionIds, locale })
        : [];
    const tSeconds = clock.getTime();
    const { commands, confirmation } = mapVoiceIntentToCommands(intent, candidates, {
      project,
      clipId,
      tSeconds,
      fps,
    });
    // Defer execution until final transcript unless unambiguous and high-confidence
    if (!segment.isFinal) {
      lastPartial = intent;
      return;
    }
    if (confirmation) {
      // Surface to UI layer (not implemented here); do not execute automatically
      lastPartial = undefined;
      return;
    }
    if (commands.length > 0) {
      dispatchCommands(commands, `${intent.verb} applied at t=${tSeconds.toFixed(2)}s.`);
      lastPartial = undefined;
    }
  });

  return {
    start: () => speech.start(),
    stop: () => speech.stop(),
    dispose: () => {
      unsubscribeSpeech();
      unsubscribeClock();
      speech.stop();
    },
  };
};

