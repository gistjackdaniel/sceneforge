# 월드 생성 · 시퀀스 공유 · 부분 재렌더

기준일: 2026-09-02

한 샷을 넘어 **같은 공간을 여러 컷이 쓰는 것**이 SceneForge의 핵심 가치다. 컷마다 월드를 복제하지 않는다.

## A. 월드 생성과 연결

```text
시작 이미지 + (선택) prompt + 탐색 카메라 경로
  → ImageToWorld job (queued / running / completed / failed)
  → WorldAsset 패키징 (segment, SpatialMemory, 3DGS/mesh)
  → Preview in Viewport 또는 Use in Current Clip
```

### 사용자 행동

1. 상단 `Worlds` 또는 Workflow `World`를 연다.
2. 샘플 월드를 쓰거나, 이미지로 새 월드를 생성한다.
3. **Preview**는 클립 그래프를 바꾸지 않는다. 공간만 본다.
4. **Use in Current Clip**이 현재 클립에 `linkedWorldId`와 `WorldReferenceNode`를 연결한다. 다른 클립은 건드리지 않는다.
5. Viewport가 열리고 Stage/Camera를 이을 수 있다.

### 완료 / 막힘

- 완료: 선택 클립의 `linkedWorldId`가 실제 `WorldAsset`을 가리킨다.
- 막힘: 월드가 없거나 삭제됨. 클립이 선택되지 않음(클립을 자동 생성하지 않는다).
- 생성 실패: job `failed`. 프로젝트 상태는 유지되고 재시도한다.

### 단축 경로

- 상단 cinematic prompt는 World Gen draft다. `World Setup`은 생성 패널로 이동한다.
- Assistant `이 구간용 방 배경 만들어줘`는 첫 번째 사용 가능 월드를 현재 클립에 연결한다.

생성 모델 내부(DiT, token, correspondence)는 보여주지 않는다. 사용자에게는 coverage %와 artifact 종류만 보인다.

## B. 다음 컷 작성 (시퀀스)

```text
Add Clip
  → 선택 중인 컷의 월드를 Shared World Reference로 상속
  → 새 클립 선택
  → Camera가 Next (월드는 이미 있음)
  → 이 컷만의 카메라·연기를 기록
  → Render
```

### 규칙

- 새 빈 클립은 타임라인에서만 만든다. World Gen이 클립을 만들지 않는다.
- 상속은 월드 **복제가 아니라 참조**다. Master World는 하나다.
- 카메라 키, 퍼포먼스 큐, 클립 override는 컷 로컬이다.
- 이전 컷에 월드가 없으면 새 컷의 World도 Next가 된다.

### 3패널 동기화

클립을 고르면 Playback·Viewport·Direction·Workflow가 그 컷의 resolved state로 바뀐다. 플레이헤드를 스크럽하면 Camera Path 키가 해당 프레임으로 이동한다.

## C. 공유 수정과 부분 재렌더

```text
Shared / Instance 노드 변경
  → DirtyEvent → 영향 컷 계산
  → 승인 전 문장 표시
      "조명 노드를 수정하면 3개 컷이 다시 렌더링됩니다."
  → Approve → 해당 컷만 proxy queue
  → Dismiss → 캐시는 invalid로 남고 수동 렌더를 기다림
```

연결되지 않은 컷의 캐시는 유지된다. 승인과 동시에 final render를 돌리지 않는다.

### 화면

기본 셸에는 Graph/Inspector가 없다. 영향 범위 승인은 Shot Workflow 아래 배너에서 한다. Timeline 클립에는 Shared 배지와 Rerender 표시가 남는다.

### 참조 관계

| 관계 | 의미 | 기본 사용 |
|------|------|-----------|
| Shared | 같은 노드. 원본 변경이 모든 참조 컷에 영향 | 월드, 공통 룩, 공통 조명 |
| Instance | 원본 + 로컬 override | 렌즈, 샷 프리셋 |
| Local | 독립 복사 | 이 컷만의 카메라 경로 |

복제는 `링크 / 인스턴스 / 독립 복사` 세 동작이다. 하나의 "복제"로 합치지 않는다.

## 수용 시나리오

1. Preview는 클립의 `linkedWorldId`를 바꾸지 않는다.
2. Use in Current Clip은 현재 클립만 연결하고 다른 클립의 월드는 유지한다.
3. Add Clip은 선택 컷의 월드를 상속하며 Camera가 Next가 된다.
4. 월드 없는 컷에서 Add Clip하면 새 컷도 World가 Next다.
5. Shared 조명 수정 시 영향 컷 목록이 승인 전에 보인다.
6. 승인하지 않으면 렌더 큐에 들어가지 않는다.
7. 생성 job 실패는 프로젝트 그래프를 손상시키지 않는다.
