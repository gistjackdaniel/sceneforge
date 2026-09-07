# 리뷰 · 부분 재생성 · 편집 교환

기준일: 2026-09-02

렌더는 샷의 끝이 아니다. **결과를 보고, 바꾸면 안 되는 채널을 잠그고, 타이밍을 편집 도구와 왕복한다.**

## A. Review

```text
Render
  → capability 협상 (unsupported/prompt/reference/exact, Lock/Strength/Mask)
  → explicit downgrade 기록
  → proxy 또는 final cache
  → Playback에서 재생
```

### 사용자 행동

1. 샷 계약이 성립하면 Playback의 Render가 활성화된다.
2. 결과 영상을 본다. Workflow Render 단계는 `Final render ready`가 된다.
3. 카메라만 고칠지, 연기만 고칠지, 대사 몇 프레임만 고칠지 결정한다.
4. 확정되면 OTIO(무손실) 또는 Premiere XML / EDL로 넘긴다.

### 막힘 / 실패

- 계약 blocker가 있으면 Render는 `Complete shot setup`이고 첫 해결 행동이 보인다.
- job `failed`면 메시지가 Playback에 남고, 그래프는 유지된다. 다시 Render할 수 있다.
- 거절된 라이브 액션/모캡은 렌더를 차단한다.
- 낮은 트래킹·컨택 신뢰도, 높은 발 미끄러짐은 경고만 한다.

Assistant의 렌더 칩도 같은 게이트를 쓴다. 계약이 없으면 생성 요청이 나가지 않는다.

## B. 채널·프레임 부분 재렌더

```text
Camera / Structure / Body / Face / Audio 중 일부 변경
  → directionInvalidations 누적 (채널 + clip-local frame range)
  → Render 버튼이 Re-render N channel(s)
  → 다음 요청의 rerenderScope로 전달
```

예: 대사 큐 12–24f만 고치면 body/face의 그 구간만 무효화된다. 카메라 경로를 잠근 채 연기만 다시 뽑을 수 있다.

3D 프리비즈의 바디 메카닉·컨택·표정·의상·보간 궤적은 최종 퍼포먼스 소스가 아니다. Review에서도 이 분리를 유지한다.

## C. 편집 교환

```text
Direction Plan
  ├─ Export OTIO     — cue, 오디오, 전체 plan metadata (`metadata.sceneforge`)
  ├─ Export Premiere XML — sequence marker, 편집 오디오, frame rate
  └─ Export EDL      — record timecode → action range + SceneForge comment

Import
  ├─ SceneForge가 내보낸 파일 → 가능한 한 plan 복원
  └─ 일반 XML/EDL → 기존 Performance Source·Channel Control 유지, 타이밍만 병합
```

무손실 기준 형식은 OTIO다. Playback의 Export OTIO는 Review 직후 경로이고, Direction의 Import/Export가 전체 형식이다.

가져온 큐가 클립 범위를 벗어나면 Performance가 blocker가 되고 렌더가 다시 막힌다.

## 수용 시나리오

1. 계약이 유효하고 final cache가 있으면 Render 단계는 완료 + Review다.
2. Performance 12–24f 수정 후 Render는 해당 채널 재렌더를 안내한다.
3. 렌더 실패 후 노드·월드는 그대로이고 재시도할 수 있다.
4. OTIO round-trip은 cue, 오디오 가이드, Direction Plan을 복원한다.
5. 일반 EDL import는 퍼포먼스 소스를 지우지 않고 타이밍만 바꾼다.
6. 계약이 성립하기 전에는 Assistant 렌더 칩도 실행되지 않는다.
