import type { Shot, Subject } from "../shot/types";
import { createWorldTargetResolver, type TargetMatch } from "../worlds/query";
import type { WorldAsset } from "../worlds/types";

export interface ResolvedSubject {
  worldAssetId: string;
  subjectId: string;
  label: string;
}

/**
 * Name → stage subject.
 *
 * `createWorldTargetResolver` returns a `WorldAsset.id`. The shot stores that id on
 * `subject.assetId`. When a match carries `instanceId` and it equals a subject id, that wins.
 * Does not modify worlds or the shot.
 */
export const resolveSubjectByName = (
  worlds: Record<string, WorldAsset>,
  shot: Shot,
  refText: string,
  locale: "ko" | "en",
): ResolvedSubject | { error: string } => {
  const query = refText.trim();
  if (!query) return { error: "대상 이름이 비어 있습니다." };
  const resolver = createWorldTargetResolver(worlds);
  const matches = resolver.resolve(query, {
    selectionIds: shot.subjects.map((subject) => subject.assetId),
    locale,
  });
  if (matches.length === 0) return { error: `대상을 찾지 못했습니다: ${query}` };
  const top = matches[0];
  const fromInstance = subjectForInstance(shot, top);
  if (fromInstance) return fromInstance;
  const bound = shot.subjects.filter((subject) => subject.assetId === top.assetId);
  if (bound.length === 1) return toResolved(bound[0]);
  if (bound.length > 1) {
    return { error: "같은 WorldAsset에 주체가 여러 개입니다. subject id가 필요합니다." };
  }
  return { error: "WorldAsset은 찾았지만 이 샷에 연결되어 있지 않습니다." };
};

const toResolved = (subject: Subject): ResolvedSubject => ({
  worldAssetId: subject.assetId,
  subjectId: subject.id,
  label: subject.name,
});

const subjectForInstance = (shot: Shot, match: TargetMatch): ResolvedSubject | undefined => {
  const instanceId = match.instanceId;
  if (!instanceId) return undefined;
  const subject = shot.subjects.find((item) => item.id === instanceId);
  return subject ? toResolved(subject) : undefined;
};
