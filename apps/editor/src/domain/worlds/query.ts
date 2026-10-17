import type { WorldAsset, WorldElement } from "./types";

export type TargetKind = "character" | "prop" | "location";

export type TargetMatch = {
  assetId: WorldAsset["id"];
  kind: TargetKind;
  displayName: string;
  score: number;
};

export type ResolveContext = { selectionIds: string[]; locale: "ko" | "en" };

type IndexedEntry = {
  assetId: string;
  kind: TargetKind;
  labelEn: string;
  labelKo: string;
  synonyms: string[];
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

export const createWorldQueryIndex = (worlds: Record<string, WorldAsset>): WorldQueryIndex => {
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
      if (ctx.selectionIds?.includes(entry.assetId)) score += 10;
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
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  };

  return { getWorldById, resolveCandidates };
};

// Agentic lane TargetResolver port
export type TargetResolver = {
  resolve: (refText: string, ctx: ResolveContext) => TargetMatch[];
};

export const createWorldTargetResolver = (worlds: Record<string, WorldAsset>): TargetResolver => {
  const index = createWorldQueryIndex(worlds);
  return {
    resolve: (refText: string, ctx: ResolveContext) => index.resolveCandidates(refText, ctx),
  };
};

