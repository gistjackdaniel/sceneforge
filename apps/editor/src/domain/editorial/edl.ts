import {
  performancePlanFromNode,
  type PerformanceCue,
  type PerformancePlanParams,
} from "../performance";
import type { PremiereXmlExchangeInput, PremiereXmlImportOptions } from "./premiereXml";

export interface EdlImportResult {
  ok: boolean;
  performancePlan?: PerformancePlanParams;
  fps?: number;
  issues: string[];
  warnings: string[];
}

interface EdlEvent {
  number: string;
  track: string;
  recordIn: number;
  recordOut: number;
  name?: string;
  sourceFile?: string;
}

const encodeMetadata = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

const decodeMetadata = (value: string): unknown => {
  try {
    return JSON.parse(decodeURIComponent(value.trim()));
  } catch {
    return undefined;
  }
};

export const framesToEdlTimecode = (frames: number, fps: number): string => {
  const rate = Math.max(1, Math.round(fps));
  let rest = Math.max(0, Math.round(frames));
  const hours = Math.floor(rest / (rate * 3600));
  rest -= hours * rate * 3600;
  const minutes = Math.floor(rest / (rate * 60));
  rest -= minutes * rate * 60;
  const seconds = Math.floor(rest / rate);
  const frame = rest - seconds * rate;
  return [hours, minutes, seconds, frame]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

export const edlTimecodeToFrames = (value: string, fps: number): number | undefined => {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$/);
  if (!match) {
    return undefined;
  }
  const rate = Math.max(1, Math.round(fps));
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * rate) + Number(match[4]);
};

const normalizedCue = (value: unknown): PerformanceCue | undefined =>
  performancePlanFromNode({ cues: [value] }).cues[0];

const parseEvents = (text: string, fps: number): EdlEvent[] => {
  const events: EdlEvent[] = [];
  let current: EdlEvent | undefined;
  text.split(/\r?\n/).forEach((line) => {
    const eventMatch = line.match(
      /^\s*(\d{3,})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})/,
    );
    if (eventMatch) {
      const recordIn = edlTimecodeToFrames(eventMatch[7], fps);
      const recordOut = edlTimecodeToFrames(eventMatch[8], fps);
      if (recordIn !== undefined && recordOut !== undefined) {
        current = {
          number: eventMatch[1],
          track: eventMatch[3],
          recordIn,
          recordOut,
        };
        events.push(current);
      }
      return;
    }
    const name = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i)?.[1];
    if (name && current) {
      current.name = name.trim();
    }
    const sourceFile = line.match(/^\*\s*SOURCE FILE:\s*(.+)$/i)?.[1];
    if (sourceFile && current) {
      current.sourceFile = sourceFile.trim();
    }
  });
  return events;
};

/** Import CMX 3600 EDL timing. EDL has no native rich marker schema, so SceneForge comments are preferred. */
export const importPerformancePlanFromEdl = (
  text: string,
  options: PremiereXmlImportOptions,
): EdlImportResult => {
  if (!/^TITLE:/im.test(text) && !/^\s*\d{3,}\s+\S+\s+[VA]/im.test(text)) {
    return { ok: false, issues: ["The selected file is not a CMX 3600 EDL."], warnings: [] };
  }
  const fpsComment = Number(text.match(/^\*\s*FPS:\s*(\d+(?:\.\d+)?)\s*$/im)?.[1]);
  const fps = Number.isFinite(fpsComment) && fpsComment > 0 ? fpsComment : options.fps;
  const events = parseEvents(text, fps);
  const metadataCues = Array.from(
    text.matchAll(/^\*\s*SCENEFORGE_CUE:\s*(\S+)\s*$/gim),
    (match) => normalizedCue(decodeMetadata(match[1])),
  ).filter((cue): cue is PerformanceCue => cue !== undefined);
  const durationFrames = Math.max(1, options.durationFrames);
  const genericCues: PerformanceCue[] = events
    .filter((event) => event.track.toUpperCase().includes("V"))
    .map((event) => {
      const startFrame = Math.max(0, Math.min(durationFrames - 1, event.recordIn));
      const endFrame = Math.max(startFrame + 1, Math.min(durationFrames, event.recordOut));
      return {
        id: `edl-event-${event.number}`,
        kind: "action",
        label: event.name ?? `Edit ${event.number}`,
        direction: "Imported CMX 3600 edit range.",
        startFrame,
        endFrame,
        overlapMode: "allow",
      };
    });
  const cueSource = metadataCues.length > 0 ? metadataCues : genericCues;
  const audioMetadata = text.match(/^\*\s*SCENEFORGE_AUDIO:\s*(\S+)\s*$/im)?.[1];
  const decodedAudio = audioMetadata ? decodeMetadata(audioMetadata) : undefined;
  const audioEvent = events.find((event) => event.track.toUpperCase().includes("A"));
  const audioGuide = decodedAudio && typeof decodedAudio === "object"
    ? performancePlanFromNode({ audioGuide: decodedAudio }).audioGuide
    : audioEvent
      ? {
          label: audioEvent.name ?? "EDL audio edit",
          uri: audioEvent.sourceFile,
          offsetFrame: audioEvent.recordIn,
          durationFrames: Math.max(1, audioEvent.recordOut - audioEvent.recordIn),
        }
      : undefined;
  if (cueSource.length === 0 && !audioGuide) {
    return {
      ok: false,
      fps,
      issues: ["No video edit ranges, audio event, or SceneForge timing comments were found."],
      warnings: [],
    };
  }
  const warnings: string[] = [];
  if (/FCM:\s*DROP FRAME/i.test(text)) {
    warnings.push("Drop-frame timecode was approximated using the selected clip frame rate.");
  }
  if (metadataCues.length === 0 && genericCues.length > 0) {
    warnings.push("Generic EDL events were imported as action ranges; assign their performance meaning in Direction.");
  }
  const performancePlan = performancePlanFromNode({
    ...options.basePlan,
    cues: cueSource,
    audioGuide: audioGuide ?? options.basePlan.audioGuide,
  });
  return { ok: true, performancePlan, fps, issues: [], warnings };
};

const eventLine = (
  number: number,
  track: "V" | "A",
  startFrame: number,
  endFrame: number,
  fps: number,
): string => {
  const start = framesToEdlTimecode(startFrame, fps);
  const end = framesToEdlTimecode(endFrame, fps);
  return `${String(number).padStart(3, "0")}  AX       ${track}     C        ${start} ${end} ${start} ${end}`;
};

/** Export cue and edited-audio timing as CMX 3600 plus SceneForge comment metadata. */
export const exportPerformancePlanToEdl = (input: PremiereXmlExchangeInput): string => {
  const fps = Math.max(1, Math.round(input.fps));
  const lines = [
    `TITLE: ${input.clipName}`,
    "FCM: NON-DROP FRAME",
    `* FPS: ${fps}`,
    "",
  ];
  let eventNumber = 1;
  input.performancePlan.cues.forEach((cue) => {
    lines.push(eventLine(eventNumber, "V", cue.startFrame, cue.endFrame, fps));
    lines.push(`* FROM CLIP NAME: ${cue.label}`);
    lines.push(`* SCENEFORGE_CUE: ${encodeMetadata(cue)}`);
    lines.push("");
    eventNumber += 1;
  });
  const audio = input.performancePlan.audioGuide;
  if (audio) {
    const startFrame = Math.max(0, audio.offsetFrame);
    const endFrame = startFrame + (audio.durationFrames ?? input.durationFrames);
    lines.push(eventLine(eventNumber, "A", startFrame, endFrame, fps));
    lines.push(`* FROM CLIP NAME: ${audio.label}`);
    if (audio.uri) {
      lines.push(`* SOURCE FILE: ${audio.uri}`);
    }
    lines.push(`* SCENEFORGE_AUDIO: ${encodeMetadata(audio)}`);
    lines.push("");
  }
  return lines.join("\n");
};

