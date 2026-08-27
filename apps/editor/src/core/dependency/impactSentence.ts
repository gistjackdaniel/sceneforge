/** User-facing sentence describing rerender impact before approval (P2-B). */
export const buildImpactSentence = (nodeName: string, affectedClipNames: string[]): string => {
  if (affectedClipNames.length === 0) {
    return `${nodeName} 변경은 현재 연결된 컷에 영향을 주지 않습니다.`;
  }
  if (affectedClipNames.length === 1) {
    return `${nodeName}을(를) 수정하면 ${affectedClipNames[0]} 컷이 다시 렌더링됩니다.`;
  }
  return `${nodeName}을(를) 수정하면 ${affectedClipNames.length}개 컷(${affectedClipNames.join(", ")})이 다시 렌더링됩니다.`;
};
