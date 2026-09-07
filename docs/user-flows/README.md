# SceneForge 유저 플로우

기준일: 2026-09-02

SceneForge의 사용자는 노드를 조립하지 않는다. **한 샷의 공간·배치·카메라·연기 계약을 고정하고, 같은 월드를 다음 컷에서 재사용하며, 바뀐 부분만 다시 생성한다.**

상세 문서는 저니별로 나눈다.

| 저니 | 문서 | 핵심 질문 |
|------|------|-----------|
| 한 샷 작성 | [shot-authoring.md](shot-authoring.md) | 이 컷의 World → Stage → Camera → Performance → Render가 준비됐는가? |
| 월드·시퀀스 | [world-and-sequence.md](world-and-sequence.md) | 공간을 만들고, 다음 컷에 공유하며, 영향 범위를 승인하는가? |
| 리뷰·편집 교환 | [review-and-editorial.md](review-and-editorial.md) | 결과를 보고, 채널만 고치고, 편집 타이밍을 넘기는가? |

상태 판정의 단일 소스는 `domain/workflow/shotWorkflow.ts`다. 상단 Shot Workflow와 Playback Render 게이트가 같은 결과를 사용한다.

## 페르소나

- **감독 / 프리비즈 아티스트** — 구도, 렌즈, 시선, 180도 축, 샷 길이를 고정한다.
- **애니메이터 / 퍼포먼스 감독** — 텍스트·라이브 액션·모캡·2D 키와 편집 오디오로 연기를 넣는다.
- **에디터** — 타임라인에서 컷을 늘리고, OTIO/XML/EDL로 타이밍을 왕복한다.

노드 그래프 운영자는 기본 사용자가 아니다. Graph / Inspector / Library는 백엔드 구조이며 기본 셸에 노출하지 않는다.

## 화면 지도

```text
TopBar          Editor · Worlds · Direction · Render
Shot Workflow   World → Stage → Camera → Performance → Render
Left            World Gen | Viewport (Build / Record) | Direction
Center          Playback (proxy/final + Render)
Right           Assistant (의도 단축)
Bottom          Timeline (V1 · CAM · AUD · PERF)
```

| 하고 싶은 일 | 가는 곳 |
|--------------|---------|
| 월드 고르거나 생성 | Worlds / World Gen, 또는 Workflow → World |
| 배우·소품·조명 배치 | Viewport → Build |
| 카메라·렌즈 기록 | Viewport → Record, `K` |
| 연기·오디오·큐 | Direction |
| 렌더 / 재렌더 | Playback Render, 또는 Workflow → Render |
| 다음 컷 | Timeline → Add Clip |
| 공유 수정 승인 | Shot Workflow 아래 영향 범위 배너 |
| 편집 타이밍 내보내기 | Playback Export OTIO, 또는 Direction Import/Export |

## 제품 전체 여정

```text
프로젝트 열림 (샘플 월드가 첫 클립에 연결됨)
    │
    ├─ 첫 샷 작성 ── World 완료 → Camera가 Next
    │     Stage(선택) → Camera 키 → Performance(선택) → Render
    │
    ├─ 월드가 마음에 안 들면 ── World Gen → Use in Current Clip
    │
    ├─ 같은 공간의 다음 컷 ── Add Clip (월드 공유) → Camera부터
    │
    ├─ 룩·조명을 여러 컷에 쓰면 ── Assistant 인스턴스 / Shared 수정
    │     → 영향받는 컷 목록 승인 → proxy queue
    │
    └─ 결과 확정 ── Review → 채널 부분 재렌더 또는 OTIO/XML/EDL
```

채팅과 상단 프롬프트는 **단축 경로**다. 계약을 우회하지 않는다. Render는 샷 계약이 성립하기 전에는 시작되지 않는다.

## 내비게이션 원칙

1. 단계는 기능 설명이 아니라 그 작업을 할 수 있는 모드로 이동한다.
2. 완료 상태는 프로젝트 데이터에서 파생한다. 로컬 체크박스로 저장하지 않는다.
3. Optional은 숨기지 않는다. 환경 샷과 generic acting은 의도적 생략이다.
4. Render를 막을 때는 첫 blocker와 해결 행동을 함께 보여준다.
5. 월드는 컷마다 복제하지 않는다. 새 컷은 선택 중인 컷의 월드를 참조한다.
6. 공유 노드를 바꾸면 영향 컷을 **승인 전**에 보여준다.

## 아직 기본 셸에서 다루지 않는 것

기본 플로우를 막지 않는 항목이다. 고급 패널이나 Future로 둔다.

- Graph 전체 카탈로그, Inspector Break Link, Library 브라우저 — 백엔드 / 고급
- 타임라인 trim / split / reorder / retime
- Clip Variant 전환 UI (도메인은 있음)
- 자연어 챗의 임의 Command 번역 (현재는 칩 + 로그)
- 명시적 Save/Load (지금은 localStorage 자동 저장)
- 시퀀스 전환, 비디오 클립 import (`VideoSourceNode`는 Future)
