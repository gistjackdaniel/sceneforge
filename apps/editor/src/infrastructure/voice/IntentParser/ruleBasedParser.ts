import type { IntentParser, VoiceIntent } from "../../../application/ports/IntentParser";
import { voiceIntentSchema } from "../../../application/ports/IntentParser";

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const EN_PATTERNS: Array<{ test: (s: string) => boolean; build: (s: string) => VoiceIntent }> = [
  {
    test: (s) => /(move|translate)\s/.test(s),
    build: (s) => {
      const amount = /(-?\d+(\.\d+)?)\s*(m|meter|meters|cm|centimeter|centimeters|step|steps)?/.exec(s)?.[1];
      const dir =
        /(left|right|forward|back|backward|up|down|x|y|z)/.exec(s)?.[1] ??
        (s.includes("x") ? "x" : s.includes("y") ? "y" : s.includes("z") ? "z" : undefined);
      // Extract text after verb
      let target: string | undefined;
      const verbIdx = s.indexOf("move") >= 0 ? s.indexOf("move") : s.indexOf("translate");
      if (verbIdx >= 0) {
        const tail = s.slice(verbIdx).replace(/^(move|translate)\s+/, "");
        const tokens = tail.split(/\s+/);
        const articleStripped = tokens[0] && ["the", "a", "an"].includes(tokens[0]) ? tokens.slice(1) : tokens;
        const stopWords = new Set(["left", "right", "forward", "back", "backward", "up", "down", "x", "y", "z"]);
        const picked: string[] = [];
        for (const tok of articleStripped) {
          if (stopWords.has(tok) || /^[0-9.+-]+$/.test(tok)) break;
          picked.push(tok);
        }
        if (picked.length > 0) {
          target = picked.join(" ");
        }
      }
      if (!target && (s.includes("it") || s.includes("that"))) {
        target = "it";
      }
      return voiceIntentSchema.parse({
        verb: "move",
        targetRefs: target ? [target] : [],
        params: { direction: dir, amount: amount ? Number(amount) : undefined, units: "auto" },
        confidence: 0.9,
        locale: "en",
      });
    },
  },
  {
    test: (s) => /(rotate|turn)\s/.test(s),
    build: (s) => {
      const degrees = /(-?\d+(\.\d+)?)\s*(deg|degree|degrees)?/.exec(s)?.[1];
      const axis = /(around|about)?\s*(x|y|z|left|right|up|down)/.exec(s)?.[2];
      const target =
        /(rotate|turn)\s+(the|a|an)?\s*([a-z0-9 _-]+?)(\s|$)/.exec(s)?.[3] ??
        (s.includes("it") ? "it" : undefined);
      return voiceIntentSchema.parse({
        verb: "rotate",
        targetRefs: target ? [target] : [],
        params: { axis, degrees: degrees ? Number(degrees) : undefined },
        confidence: 0.9,
        locale: "en",
      });
    },
  },
  {
    test: (s) => /(camera|look at|look-at)/.test(s),
    build: (s) => {
      const target = /look(\s|-)?at\s+([a-z0-9 _-]+)/.exec(s)?.[2] ?? (s.includes("it") ? "it" : undefined);
      return voiceIntentSchema.parse({
        verb: "look-at",
        targetRefs: target ? [target] : [],
        params: {},
        confidence: 0.85,
        locale: "en",
      });
    },
  },
];

const KO_PATTERNS: Array<{ test: (s: string) => boolean; build: (s: string) => VoiceIntent }> = [
  {
    // "의자를 왼쪽으로 1미터", "의자 왼쪽 1m 이동"
    test: (s) => /(이동|옮겨|옮기|left|오른쪽|왼쪽|앞|뒤|위|아래)/.test(s),
    build: (s) => {
      const amount = /(-?\d+(\.\d+)?)\s*(m|미터|cm|센티미터|걸음|스텝)?/.exec(s)?.[1];
      const dir =
        /(왼쪽|오른쪽|앞|뒤|위|아래|left|right|forward|back|up|down)/.exec(s)?.[1] ??
        (s.includes("x") ? "x" : s.includes("y") ? "y" : s.includes("z") ? "z" : undefined);
      const target = /([가-힣a-z0-9 _-]+)\s*(을|를)\s*/.exec(s)?.[1] ?? (s.includes("이거") || s.includes("그거") ? "it" : undefined);
      return voiceIntentSchema.parse({
        verb: "move",
        targetRefs: target ? [target] : [],
        params: { direction: dir, amount: amount ? Number(amount) : undefined, units: "auto" },
        confidence: 0.9,
        locale: "ko",
      });
    },
  },
  {
    // "카메라 90도 회전", "의자 45도 돌려"
    test: (s) => /(회전|돌려|돌리)/.test(s),
    build: (s) => {
      const degrees = /(-?\d+(\.\d+)?)\s*(도|deg|degree|degrees)?/.exec(s)?.[1];
      const target = /([가-힣a-z0-9 _-]+)\s*(을|를)?\s*(회전|돌려|돌리)/.exec(s)?.[1] ?? (s.includes("이거") || s.includes("그거") ? "it" : undefined);
      return voiceIntentSchema.parse({
        verb: "rotate",
        targetRefs: target ? [target] : [],
        params: { degrees: degrees ? Number(degrees) : undefined },
        confidence: 0.88,
        locale: "ko",
      });
    },
  },
  {
    // "그걸 바라봐", "의자를 봐"
    test: (s) => /(봐|바라봐|주시|look)/.test(s),
    build: (s) => {
      const target = /([가-힣a-z0-9 _-]+)\s*(을|를)\s*(봐|바라봐|주시)/.exec(s)?.[1] ?? (s.includes("이거") || s.includes("그거") ? "it" : undefined);
      return voiceIntentSchema.parse({
        verb: "look-at",
        targetRefs: target ? [target] : [],
        params: {},
        confidence: 0.8,
        locale: "ko",
      });
    },
  },
];

export const ruleBasedParser = (): IntentParser => ({
  parse(input) {
    const locale = input.locale?.startsWith("ko") ? "ko" : input.locale?.startsWith("en") ? "en" : undefined;
    const s = normalize(input.text);
    const table = locale === "ko" ? KO_PATTERNS : locale === "en" ? EN_PATTERNS : [...EN_PATTERNS, ...KO_PATTERNS];
    const match = table.find((p) => p.test(s));
    if (!match) return undefined;
    return match.build(s);
  },
});

export type { VoiceIntent } from "../../../application/ports/IntentParser";

