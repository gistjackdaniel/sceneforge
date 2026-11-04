import type { WorldAsset } from "../worlds/types";
import { createWorldTargetResolver, type TargetMatch } from "../worlds/query";
import type { SubjectBinding } from "./contract";

export interface ResolvedSubject {
  worldAssetId: string;
  instanceId: string;
  label: string;
}

/**
 * Name → subject.
 *
 * `createWorldTargetResolver` returns a WorldAsset.id. The scene binds that id
 * to an opaque instance id. When World lane adds `TargetMatch.instanceId`,
 * this function reads it and stops using the single-binding fallback.
 *
 * Does not modify worlds or subjects.
 */
export const resolveSubjectByName = (
  worlds: Record<string, WorldAsset>,
  subjects: readonly SubjectBinding[],
  refText: string,
  locale: "ko" | "en",
): ResolvedSubject | { error: string } => {
  const query = refText.trim();
  if (!query) return { error: "대상 이름이 비어 있습니다." };
  const resolver = createWorldTargetResolver(worlds);
  const matches = resolver.resolve(query, {
    selectionIds: subjects.map((subject) => subject.worldAssetId),
    locale,
  });
  if (matches.length === 0) return { error: `대상을 찾지 못했습니다: ${query}` };
  const top = matches[0];
  const instanceId = readFutureInstanceId(top);
  if (instanceId) {
    const bound = subjects.find((subject) => subject.instanceId === instanceId);
    if (bound) {
      return { worldAssetId: bound.worldAssetId, instanceId: bound.instanceId, label: bound.label };
    }
  }
  const bound = subjects.filter((subject) => subject.worldAssetId === top.assetId);
  if (bound.length === 1) {
    return { worldAssetId: bound[0].worldAssetId, instanceId: bound[0].instanceId, label: bound[0].label };
  }
  if (bound.length > 1) {
    return { error: "같은 WorldAsset에 인스턴스가 여러 개입니다. instanceId 확장이 필요합니다." };
  }
  return { error: "WorldAsset은 찾았지만 이 장면에 연결되어 있지 않습니다." };
};

/** Optional field the World lane PR will add. Absent on today's TargetMatch. */
const readFutureInstanceId = (match: TargetMatch): string | undefined => {
  if (!("instanceId" in match)) return undefined;
  const value = match.instanceId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
