import {
  performancePlanFromNode,
  type PerformanceCue,
  type PerformanceCueKind,
  type PerformancePlanParams,
} from "../performance";

export interface PremiereXmlExchangeInput {
  clipId: string;
  clipName: string;
  durationFrames: number;
  fps: number;
  performancePlan: PerformancePlanParams;
}

export interface PremiereXmlImportOptions {
  basePlan: PerformancePlanParams;
  durationFrames: number;
  fps: number;
}

export interface PremiereXmlImportResult {
  ok: boolean;
  performancePlan?: PerformancePlanParams;
  fps?: number;
  issues: string[];
  warnings: string[];
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const decodeXml = (value: string): string =>
  value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/g, "&");

const tagBlocks = (source: string, tag: string): string[] =>
  Array.from(
    source.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi")),
    (match) => match[1],
  );

const tagText = (source: string, tag: string): string | undefined => {
  const block = tagBlocks(source, tag)[0];
  return block === undefined
    ? undefined
    : decodeXml(block.replace(/<[^>]+>/g, "").trim());
};

const integerTag = (source: string, tag: string): number | undefined => {
  const value = Number(tagText(source, tag));
  return Number.isFinite(value) ? Math.round(value) : undefined;
};

const encodeMetadata = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

const decodeMetadata = (value: string): unknown => {
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return undefined;
  }
};

const cueKindFromText = (value: string): PerformanceCueKind => {
  const normalized = value.toLowerCase();
  if (/dialog|line|speech|대사/.test(normalized)) {
    return "dialogue";
  }
  if (/react|reaction|리액션|반응/.test(normalized)) {
    return "reaction";
  }
  if (/hold|pause|beat|정지|쉼/.test(normalized)) {
    return "hold";
  }
  return "action";
};

const normalizedCueFromMetadata = (value: unknown): PerformanceCue | undefined =>
  performancePlanFromNode({ cues: [value] }).cues[0];

const markerFromXml = (
  block: string,
  index: number,
  durationFrames: number,
): PerformanceCue | undefined => {
  const name = tagText(block, "name") ?? `Marker ${index + 1}`;
  const rawComment = tagText(block, "comment") ?? "";
  const metadataMatch = rawComment.match(/^SCENEFORGE_CUE\s+(\S+)(?:\r?\n([\s\S]*))?$/);
  const metadataCue = metadataMatch
    ? normalizedCueFromMetadata(decodeMetadata(metadataMatch[1]))
    : undefined;
  const rawStart = integerTag(block, "in") ?? metadataCue?.startFrame ?? 0;
  const rawEnd = integerTag(block, "out") ?? metadataCue?.endFrame ?? rawStart + 1;
  const startFrame = Math.max(0, Math.min(durationFrames - 1, rawStart));
  const endFrame = Math.max(startFrame + 1, Math.min(durationFrames, rawEnd));
  const direction = metadataMatch ? metadataMatch[2] ?? metadataCue?.direction ?? "" : rawComment;
  return {
    ...(metadataCue ?? {
      id: `premiere-marker-${index + 1}`,
      kind: cueKindFromText(`${name} ${rawComment}`),
      label: name,
      direction,
      startFrame,
      endFrame,
      overlapMode: "allow" as const,
    }),
    label: name,
    direction,
    startFrame,
    endFrame,
  };
};

const planMetadataFromSequence = (sequence: string): PerformancePlanParams | undefined => {
  const description = tagBlocks(sequence, "description")
    .map((value) => decodeXml(value.replace(/<[^>]+>/g, "").trim()))
    .find((value) => value.startsWith("SCENEFORGE_PLAN "));
  if (!description) {
    return undefined;
  }
  const decoded = decodeMetadata(description.slice("SCENEFORGE_PLAN ".length));
  return decoded && typeof decoded === "object"
    ? performancePlanFromNode(decoded as Record<string, unknown>)
    : undefined;
};

const audioGuideFromSequence = (
  sequence: string,
  fallbackDuration: number,
): PerformancePlanParams["audioGuide"] => {
  const audioBlock = tagBlocks(sequence, "audio")[0];
  const clipItem = audioBlock ? tagBlocks(audioBlock, "clipitem")[0] : undefined;
  if (!clipItem) {
    return undefined;
  }
  const label = tagText(clipItem, "name") ?? "Premiere audio edit";
  const startFrame = integerTag(clipItem, "start") ?? 0;
  const endFrame = integerTag(clipItem, "end");
  const pathUrl = tagText(clipItem, "pathurl");
  const fileName = tagBlocks(clipItem, "file")[0]
    ? tagText(tagBlocks(clipItem, "file")[0], "name")
    : undefined;
  return {
    label,
    uri: pathUrl ?? fileName,
    offsetFrame: startFrame,
    durationFrames: Math.max(1, (endFrame ?? startFrame + fallbackDuration) - startFrame),
  };
};

/** Import Final Cut Pro 7 XML as written by Premiere's legacy XML interchange. */
export const importPerformancePlanFromPremiereXml = (
  xml: string,
  options: PremiereXmlImportOptions,
): PremiereXmlImportResult => {
  if (!/<xmeml(?:\s|>)/i.test(xml) || !/<sequence(?:\s|>)/i.test(xml)) {
    return {
      ok: false,
      issues: ["The selected XML is not a Premiere / Final Cut Pro 7 sequence document."],
      warnings: [],
    };
  }
  const sequence = tagBlocks(xml, "sequence")[0] ?? xml;
  const fps = integerTag(sequence, "timebase") ?? options.fps;
  const durationFrames = Math.max(1, options.durationFrames);
  const embeddedPlan = planMetadataFromSequence(sequence);
  const markers = tagBlocks(sequence, "marker")
    .map((block, index) => markerFromXml(block, index, durationFrames))
    .filter((cue): cue is PerformanceCue => cue !== undefined);
  const audioGuide = audioGuideFromSequence(sequence, durationFrames);
  const sourcePlan = embeddedPlan ?? options.basePlan;
  if (markers.length === 0 && !audioGuide && !embeddedPlan) {
    return {
      ok: false,
      fps,
      issues: ["No sequence markers, edited audio clip, or SceneForge metadata was found."],
      warnings: [],
    };
  }
  const performancePlan = performancePlanFromNode({
    ...sourcePlan,
    cues: markers.length > 0 ? markers : sourcePlan.cues,
    audioGuide: audioGuide ?? sourcePlan.audioGuide,
  });
  const warnings: string[] = [];
  if (!embeddedPlan) {
    warnings.push("Generic Premiere XML carries timing only; existing performance sources and channel controls were preserved.");
  }
  if (integerTag(sequence, "duration") && integerTag(sequence, "duration") !== durationFrames) {
    warnings.push(`Sequence duration differs from the selected SceneForge clip (${durationFrames}f); imported ranges were clamped.`);
  }
  return { ok: true, performancePlan, fps, issues: [], warnings };
};

const rateXml = (fps: number): string =>
  `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;

const markerXml = (cue: PerformanceCue): string => {
  const metadata = encodeMetadata(cue);
  const comment = `SCENEFORGE_CUE ${metadata}\n${cue.direction}`;
  return [
    "<marker>",
    `<name>${escapeXml(cue.label)}</name>`,
    `<comment>${escapeXml(comment)}</comment>`,
    `<in>${cue.startFrame}</in>`,
    `<out>${cue.endFrame}</out>`,
    "</marker>",
  ].join("");
};

/** Export the current shot timing as Premiere-compatible Final Cut Pro 7 XML. */
export const exportPerformancePlanToPremiereXml = (
  input: PremiereXmlExchangeInput,
): string => {
  const fps = Math.max(1, Math.round(input.fps));
  const durationFrames = Math.max(1, Math.round(input.durationFrames));
  const audio = input.performancePlan.audioGuide;
  const audioStart = audio?.offsetFrame ?? 0;
  const audioDuration = audio?.durationFrames ?? durationFrames;
  const audioXml = audio
    ? [
        "<audio><track><clipitem id=\"sceneforge-audio-1\">",
        `<name>${escapeXml(audio.label)}</name>`,
        `<start>${audioStart}</start><end>${audioStart + audioDuration}</end>`,
        `<in>0</in><out>${audioDuration}</out>${rateXml(fps)}`,
        "<file id=\"sceneforge-audio-file-1\">",
        `<name>${escapeXml(audio.label)}</name>`,
        audio.uri ? `<pathurl>${escapeXml(audio.uri)}</pathurl>` : "",
        `${rateXml(fps)}<duration>${audioDuration}</duration>`,
        "</file></clipitem></track></audio>",
      ].join("")
    : "<audio/>";
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE xmeml>",
    "<xmeml version=\"5\"><sequence id=\"sceneforge-sequence-1\">",
    `<name>${escapeXml(input.clipName)}</name>`,
    `<duration>${durationFrames}</duration>${rateXml(fps)}`,
    `<description>${escapeXml(`SCENEFORGE_PLAN ${encodeMetadata(input.performancePlan)}`)}</description>`,
    input.performancePlan.cues.map(markerXml).join(""),
    `<media><video><track/></video>${audioXml}</media>`,
    "</sequence></xmeml>",
  ].join("\n");
};

