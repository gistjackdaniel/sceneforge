import { matchRigParts, stripRigPartWords, type RigPart } from "../worlds/sceneState";

export type TemporalType = "before" | "after" | "while";

export type HandSpec = {
  /** Set only when the clause names exactly one rig part. */
  rigPart?: RigPart;
  count: number;
};

export type DirectionAction =
  | { kind: "handshake"; actors: string[]; hand: HandSpec }
  | { kind: "place"; actor: string; object: string; surface?: string; hand: HandSpec }
  | { kind: "approach"; actor: string };

export type DirectionStep = {
  action: DirectionAction;
  phrase: string;
  durationSeconds: number;
  /** How this step sits relative to the previous step. The first step has none. */
  relation?: { type: TemporalType; offsetSeconds: number };
};

export type ParsedDirection =
  | { type: "edit_contact_hand"; actor: string; hand: HandSpec }
  | { type: "sequence"; steps: DirectionStep[] }
  | { type: "unknown" };

const DEFAULT_DURATION_SECONDS = 2;

const TRAILING_PARTICLE = /(?:으로|에서|에게|한테|이랑|은|는|을|를|와|과|의|에|로|도|이|가)$/u;

const normalize = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[.!?。](?!\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const cleanMention = (raw: string): string => {
  let value = normalize(stripRigPartWords(raw));
  value = value.replace(/악수(?:합니다|한다|하자|해요|해)?/g, " ").replace(/handshake/gi, " ");
  value = value.replace(/내려\s*놓(?:습니다|는다|아요|아)?/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = value.replace(TRAILING_PARTICLE, "").trim();
    if (next.length === 0 || next === value) break;
    value = next;
  }
  return value;
};

const handSpec = (clause: string): HandSpec => {
  const parts = matchRigParts(clause);
  return { count: parts.length, ...(parts.length === 1 ? { rigPart: parts[0] } : {}) };
};

const durationSeconds = (clause: string): number => {
  const match = clause.match(/(\d+(?:\.\d+)?)\s*초\s*동안/);
  if (!match?.[1]) return DEFAULT_DURATION_SECONDS;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DURATION_SECONDS;
};

const parseHandshake = (clause: string): DirectionAction | undefined => {
  if (!clause.includes("악수") && !/handshake/i.test(clause)) return undefined;
  const body = cleanMention(clause);
  const pair = body.match(/^(.+?)\s*(?:와|과|랑|하고|and)\s+(.+)$/i);
  if (pair?.[1] && pair[2]) {
    const actors = [cleanMention(pair[1]), cleanMention(pair[2])].filter((actor) => actor.length > 0);
    if (actors.length > 0) return { kind: "handshake", actors, hand: handSpec(clause) };
  }
  const one = cleanMention(body);
  if (!one) return undefined;
  return { kind: "handshake", actors: [one], hand: handSpec(clause) };
};

const parsePlace = (clause: string): DirectionAction | undefined => {
  if (!/내려\s*놓/.test(clause) && !/\bplace\b/i.test(clause)) return undefined;
  const match = clause.match(/^(.+?)(?:이|가)\s+(.+?)(?:을|를)\s+(.+?)(?:에|에게)\s*내려\s*놓/);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const surface = cleanMention(match[3]);
  return {
    kind: "place",
    actor: cleanMention(match[1]),
    object: cleanMention(match[2]),
    ...(surface ? { surface } : {}),
    hand: handSpec(clause),
  };
};

const parseApproach = (clause: string): DirectionAction | undefined => {
  if (!/다가/.test(clause) && !/approach/i.test(clause)) return undefined;
  const match = clause.match(/^(.+?)(?:이|가|은|는)?\s*다가/);
  if (!match?.[1]) return undefined;
  const actor = cleanMention(match[1]);
  if (!actor) return undefined;
  return { kind: "approach", actor };
};

const parseClause = (clause: string): DirectionAction | undefined =>
  parseHandshake(clause) ?? parsePlace(clause) ?? parseApproach(clause);

type TemporalSplit = { left: string; right: string; type: TemporalType; offsetSeconds: number };

const splitTemporal = (text: string): TemporalSplit | undefined => {
  const whileMatch = text.match(/^(.*?)(?:하면서|면서)\s*(.+)$/);
  if (whileMatch?.[1] && whileMatch[2]) {
    return { left: whileMatch[1].trim(), right: whileMatch[2].trim(), type: "while", offsetSeconds: 0 };
  }
  const before = text.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)\s*초)?\s*전에\s+(.+)$/);
  if (before?.[1] && before[3]) {
    const offset = before[2] ? Number(before[2]) : 0;
    return {
      left: before[1].replace(/하기$/, "").trim(),
      right: before[3].trim(),
      type: "before",
      offsetSeconds: Number.isFinite(offset) ? offset : 0,
    };
  }
  const after = text.match(/^(.*?)\s+(?:(\d+(?:\.\d+)?)\s*초\s*)?(?:다음|후에|뒤에)\s+(?:(\d+(?:\.\d+)?)\s*초\s*(?:후에|뒤에)\s+)?(.+)$/);
  if (after?.[1] && after[4]) {
    const offset = Number(after[3] ?? after[2] ?? 0);
    return { left: after[1].trim(), right: after[4].trim(), type: "after", offsetSeconds: Number.isFinite(offset) ? offset : 0 };
  }
  return undefined;
};

const stepFrom = (clause: string, relation?: DirectionStep["relation"]): DirectionStep | undefined => {
  const action = parseClause(clause);
  if (!action) return undefined;
  return { action, phrase: clause.trim(), durationSeconds: durationSeconds(clause), ...(relation ? { relation } : {}) };
};

/**
 * Deterministic direction parser. Unknown wording stays `unknown` so the producer can ask.
 * No side effects.
 */
export const parseDirection = (text: string): ParsedDirection => {
  const utterance = normalize(text);
  if (!utterance) return { type: "unknown" };
  const edit = utterance.match(/^(.+?)\s*접촉\s*손만\s*(?:수정|변경|바꿔(?:요|라)?|바꾼다|바꾸기)?$/);
  if (edit?.[1]) {
    const actor = cleanMention(edit[1]);
    if (!actor) return { type: "unknown" };
    return { type: "edit_contact_hand", actor, hand: handSpec(utterance) };
  }
  const split = splitTemporal(utterance);
  if (!split) {
    const step = stepFrom(utterance);
    return step ? { type: "sequence", steps: [step] } : { type: "unknown" };
  }
  const left = stepFrom(split.left);
  const right = stepFrom(split.right, { type: split.type, offsetSeconds: split.offsetSeconds });
  if (!left || !right) return { type: "unknown" };
  return { type: "sequence", steps: [left, right] };
};
