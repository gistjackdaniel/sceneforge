import type { WorldAsset } from "../worlds/types";
import {
  createWorldTargetResolver,
  type ResolveContext,
  type TargetMatch,
} from "../worlds/query";

export interface DraftTargetResolution {
  accepted: TargetMatch[];
  unresolved: string[];
  ambiguous: string[];
}

/**
 * 샷 프롬프트의 @멘션 대상 조회.
 * World #21 `createWorldTargetResolver`만 사용한다.
 * 에셋 목록을 직접 스캔하지 않고, 비밀값을 받지 않는다.
 */
export class DraftTargetLookup {
  /** `@토큰` 또는 공백이 있는 `@[이름]`을 읽는다. */
  static mentionTokens(prompt: string): string[] {
    const found: string[] = [];
    const pattern = /@\[([^\]]+)\]|@([^\s@,;[\]]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const token = (match[1] ?? match[2])?.trim();
      if (token && !found.includes(token)) found.push(token);
    }
    return found;
  }

  /** `TargetResolver.resolve` 결과만 반환한다. */
  static resolve(worlds: Record<string, WorldAsset>, refText: string, ctx: ResolveContext): TargetMatch[] {
    return createWorldTargetResolver(worlds).resolve(refText, ctx);
  }

  /**
   * 프롬프트의 각 @멘션을 조회한다.
   * 최고 점수가 서로 다른 WorldAsset.id에 같으면 모호한 것으로 보고 고르지 않는다.
   */
  static resolvePrompt(worlds: Record<string, WorldAsset>, prompt: string, ctx: ResolveContext): DraftTargetResolution {
    const unresolved: string[] = [];
    const ambiguous: string[] = [];
    const accepted: TargetMatch[] = [];
    const seen = new Set<string>();
    for (const token of DraftTargetLookup.mentionTokens(prompt)) {
      const matches = DraftTargetLookup.resolve(worlds, token, ctx);
      if (matches.length === 0) {
        unresolved.push(token);
        continue;
      }
      const best = matches[0]?.score ?? 0;
      const top = matches.filter((item) => item.score === best);
      const assetIds = new Set(top.map((item) => item.assetId));
      if (assetIds.size > 1) {
        ambiguous.push(token);
        continue;
      }
      for (const item of top) {
        const key = `${item.assetId}:${item.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        accepted.push(item);
      }
    }
    return { accepted, unresolved, ambiguous };
  }
}
