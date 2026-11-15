import { matchRigParts, stripRigPartWords, type RigPart, type SceneState } from "./sceneState";
import type { WorldAsset, WorldElement } from "./types";

export type TargetKind = "character" | "prop" | "location";

export type TargetMatch = {
  /** `WorldAsset.id`, including matches that came from an element or an instance in that world. */
  assetId: WorldAsset["id"];
  kind: TargetKind;
  displayName: string;
  score: number;
  /** Set when the match is one actor or object instance. Distinguishes A from B inside one world. */
  instanceId?: string;
  /** Set when the match came from a `WorldElement`. The element id used to be dropped. */
  elementId?: string;
};

export type ResolveContext = { selectionIds: string[]; locale: "ko" | "en" };

type IndexedEntry = {
  assetId: string;
  kind: TargetKind;
  labelEn: string;
  labelKo: string;
  synonyms: string[];
  instanceId?: string;
  elementId?: string;
};

const mapElementKindToTarget = (kind: WorldElement["kind"]): TargetKind | undefined => {
  switch (kind) {
    case "actor_mark":
      return "character";
    case "room":
    case "zone":
      return "location";
    case "socket":
      return "prop";
    default:
      return undefined;
  }
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitTokens = (text: string): string[] => normalize(text).split(" ").filter(Boolean);

const unique = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

const bestStringSimilarity = (query: string, candidates: string[]): number => {
  if (!query) return 0;
  const q = normalize(query);
  let best = 0;
  for (const c of candidates) {
    const t = normalize(c);
    if (!t) continue;
    if (t === q) {
      best = Math.max(best, 1);
      continue;
    }
    if (t.includes(q) || q.includes(t)) {
      best = Math.max(best, 0.82);
      continue;
    }
    const qt = splitTokens(q);
    const ct = splitTokens(t);
    const inter = qt.filter((tok) => ct.includes(tok)).length;
    if (inter > 0) {
      // Jaccard-like ratio
      const ratio = inter / Math.max(qt.length, ct.length);
      best = Math.max(best, 0.55 + 0.4 * ratio);
    }
  }
  return best;
};

const detectKindHint = (query: string): TargetKind | undefined => {
  const q = normalize(query);
  if (/(character|actor|캐릭터|인물)/.test(q)) return "character";
  if (/(prop|소품)/.test(q)) return "prop";
  if (/(location|로케이션|장소|room|zone|world)/.test(q)) return "location";
  return undefined;
};

const labelForLocale = (entry: IndexedEntry, locale: ResolveContext["locale"]): string =>
  (locale === "ko" ? entry.labelKo : entry.labelEn) || entry.labelEn || entry.labelKo;

export interface WorldQueryIndex {
  getWorldById: (id: string) => WorldAsset | undefined;
  resolveCandidates: (refText: string, ctx: ResolveContext) => TargetMatch[];
}

export const createWorldQueryIndex = (
  worlds: Record<string, WorldAsset>,
  sceneStates?: Record<string, SceneState>,
): WorldQueryIndex => {
  const worldById = new Map<string, WorldAsset>(Object.values(worlds).map((w) => [w.id, w]));
  const entries: IndexedEntry[] = [];

  const pushSynonyms = (values: (string | undefined)[]): string[] =>
    unique(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0));

  for (const world of worldById.values()) {
    // Location entry from world record itself
    const worldLabelEn = world.localizedNames?.en || world.name;
    const worldLabelKo = world.localizedNames?.ko || world.name;
    const worldSynonyms = unique([
      world.name,
      ...(world.aliases ?? []),
      ...(world.semanticTags ?? []),
      world.localizedNames?.en,
      world.localizedNames?.ko,
    ].filter((v): v is string => !!v && v.length > 0));
    entries.push({
      assetId: world.id,
      kind: "location",
      labelEn: worldLabelEn,
      labelKo: worldLabelKo,
      synonyms: worldSynonyms,
    });

    // Element-derived entries (character/prop/location)
    for (const element of world.elements ?? []) {
      const targetKind = mapElementKindToTarget(element.kind);
      if (!targetKind) continue;
      const labelEn = element.localizedNames?.en || element.name;
      const labelKo = element.localizedNames?.ko || element.name;
      const synonyms = pushSynonyms([element.name, ...(element.aliases ?? []), element.localizedNames?.en, element.localizedNames?.ko]);
      entries.push({
        assetId: world.id,
        kind: targetKind,
        labelEn,
        labelKo,
        synonyms,
        elementId: element.id,
      });
    }

    // World-declared props list -> "prop" targets
    for (const propName of world.props ?? []) {
      const label = String(propName);
      if (!label) continue;
      entries.push({
        assetId: world.id,
        kind: "prop",
        labelEn: label,
        labelKo: label,
        synonyms: [label],
      });
    }
  }

  for (const scene of Object.values(sceneStates ?? {})) {
    const instances = [...Object.values(scene.actors), ...Object.values(scene.objects)];
    for (const instance of instances) {
      if (instance.deletedAt) continue;
      const kind: TargetKind =
        instance.type === "actor" ? "character" : instance.role === "set_piece" ? "location" : "prop";
      entries.push({
        assetId: scene.worldId,
        kind,
        labelEn: instance.localizedNames.en || instance.label,
        labelKo: instance.localizedNames.ko || instance.label,
        synonyms: pushSynonyms([instance.label, ...instance.aliases, ...Object.values(instance.localizedNames)]),
        instanceId: instance.id,
      });
    }
  }

  const getWorldById = (id: string): WorldAsset | undefined => worldById.get(id);

  const resolveCandidates = (refText: string, ctx: ResolveContext): TargetMatch[] => {
    const query = String(refText ?? "").trim();
    if (!query) return [];
    const kindHint = detectKindHint(query);
    const results: TargetMatch[] = [];
    for (const entry of entries) {
      const baseSim = bestStringSimilarity(query, [entry.labelEn, entry.labelKo, ...entry.synonyms]);
      if (baseSim <= 0) continue;
      let score = Math.round(baseSim * 100);
      if (kindHint) {
        if (kindHint === entry.kind) score += 10;
        else score -= 15;
      }
      if (
        ctx.selectionIds?.includes(entry.assetId) ||
        (entry.instanceId !== undefined && ctx.selectionIds?.includes(entry.instanceId)) ||
        (entry.elementId !== undefined && ctx.selectionIds?.includes(entry.elementId))
      ) {
        score += 10;
      }
      // Slight preference for exact label match
      const normQuery = normalize(query);
      const isExact = [entry.labelEn, entry.labelKo, ...entry.synonyms].some((s) => normalize(s) === normQuery);
      if (isExact) score += 5;
      // Keep only meaningful matches
      if (score < 30) continue;
      results.push({
        assetId: entry.assetId,
        kind: entry.kind,
        displayName: labelForLocale(entry, ctx.locale),
        score,
        ...(entry.instanceId ? { instanceId: entry.instanceId } : {}),
        ...(entry.elementId ? { elementId: entry.elementId } : {}),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  };

  return { getWorldById, resolveCandidates };
};

export type MentionEntityKind = "actor" | "object" | "location";

export type MentionCandidate = {
  persistentId: string;
  entityKind: MentionEntityKind;
  displayName: string;
  score: number;
};

export type MentionContext = ResolveContext & {
  /** Restrict candidates before the ambiguity check. */
  entityKind?: MentionEntityKind;
};

/**
 * Speech mention result.
 * Ambiguous demonstratives stay unresolved. The caller asks; this function does not pick one.
 */
export type MentionResolution =
  | {
      status: "resolved";
      persistentId: string;
      entityKind: MentionEntityKind;
      displayName: string;
      rigPart?: RigPart;
    }
  | { status: "ambiguous"; candidates: MentionCandidate[]; rigPart?: RigPart }
  | { status: "part"; rigPart: RigPart }
  | { status: "missing"; rigPart?: RigPart };

const AMBIGUOUS_SCORE_GAP = 12;

const TRAILING_PARTICLE = /(?:으로|에서|에게|한테|이랑|은|는|을|를|와|과|의|에|로|도|이|가)$/u;

const DEMONSTRATIVE = /^(?:이것|저것|그것|이거|저거|그거|this|that|the|이|그|저)\s+/i;

const entityKindOf = (kind: TargetKind): MentionEntityKind => {
  if (kind === "character") return "actor";
  if (kind === "prop") return "object";
  return "location";
};

const cleanMentionText = (text: string): { query: string; demonstrative: boolean } => {
  let value = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const demonstrative = DEMONSTRATIVE.test(value);
  value = value.replace(DEMONSTRATIVE, "").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = value.replace(TRAILING_PARTICLE, "").trim();
    if (next.length === 0 || next === value) break;
    value = next;
  }
  return { query: value, demonstrative };
};

// Agentic lane TargetResolver port
export type TargetResolver = {
  resolve: (refText: string, ctx: ResolveContext) => TargetMatch[];
  /**
   * Resolve one spoken mention to a persistent instance id and, when the words name one, a rig part.
   * Two close matches, including "그 컵" when two cups exist, come back as `ambiguous`.
   */
  resolveMention: (refText: string, ctx: MentionContext) => MentionResolution;
};

export const createWorldTargetResolver = (
  worlds: Record<string, WorldAsset>,
  sceneStates?: Record<string, SceneState>,
): TargetResolver => {
  const index = createWorldQueryIndex(worlds, sceneStates);
  const resolveMention = (refText: string, ctx: MentionContext): MentionResolution => {
    const parts = matchRigParts(refText);
    const rigPart = parts.length === 1 ? parts[0] : undefined;
    const { query, demonstrative } = cleanMentionText(stripRigPartWords(refText));
    if (!query) {
      return rigPart ? { status: "part", rigPart } : { status: "missing", ...(rigPart ? { rigPart } : {}) };
    }
    const ranked = new Map<string, MentionCandidate>();
    for (const match of index.resolveCandidates(query, ctx)) {
      if (!match.instanceId) continue;
      const entityKind = entityKindOf(match.kind);
      if (ctx.entityKind && ctx.entityKind !== entityKind) continue;
      const current = ranked.get(match.instanceId);
      if (!current || match.score > current.score) {
        ranked.set(match.instanceId, {
          persistentId: match.instanceId,
          entityKind,
          displayName: match.displayName,
          score: match.score,
        });
      }
    }
    const candidates = [...ranked.values()].sort((a, b) => b.score - a.score);
    if (candidates.length === 0) return { status: "missing", ...(rigPart ? { rigPart } : {}) };
    const selected = candidates.filter((candidate) => ctx.selectionIds.includes(candidate.persistentId));
    const closeGap = demonstrative ? 20 : AMBIGUOUS_SCORE_GAP;
    const close = candidates.length > 1 && candidates[1]!.score >= candidates[0]!.score - closeGap;
    const winner = selected.length === 1 ? selected[0] : !close ? candidates[0] : undefined;
    if (!winner) return { status: "ambiguous", candidates, ...(rigPart ? { rigPart } : {}) };
    return {
      status: "resolved",
      persistentId: winner.persistentId,
      entityKind: winner.entityKind,
      displayName: winner.displayName,
      ...(rigPart ? { rigPart } : {}),
    };
  };
  return {
    resolve: (refText: string, ctx: ResolveContext) => index.resolveCandidates(refText, ctx),
    resolveMention,
  };
};

