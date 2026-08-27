# SceneForge Node Graph Architecture

> **Cursor Rules:** `apps/editor` 구현 시 [.cursor/rules/sceneforge-node-graph.mdc](.cursor/rules/sceneforge-node-graph.mdc)와 [.cursor/rules/sceneforge-overview.mdc](.cursor/rules/sceneforge-overview.mdc)를 따른다.

## 0. 한 줄 정의

SceneForge의 노드 그래프는 사용자가 직접 다뤄야 하는 복잡한 노드 편집기가 아니라, 같은 월드·자산·룩을 여러 컷에서 공유하고, 변경된 부분만 다시 렌더링하기 위한 **제작 상태 그래프**다.

Lyra 2.0은 `image -> camera trajectory -> long-horizon video -> SpatialMemoryCache -> 3DGS / surface mesh`를 만드는 월드 생성 백엔드로 사용한다. SceneForge는 그 결과를 `WorldAssetNode`로 받아 노드 참조, 컷 간 공유, 타임라인 렌더링으로 연결한다.

---

## 1. 핵심 원칙

### 1.1 사용자가 체감해야 할 가치

- 한 번 만든 월드를 여러 컷에서 재사용한다.
- 같은 캐릭터, 소품, 룩, 카메라 세팅을 컷 간 공유한다.
- 노드를 수정하면 어떤 컷이 영향을 받는지 미리 보여준다.
- 변경된 노드와 연결된 컷만 부분 재렌더링한다.
- 그래프는 일관성과 자동 반영을 설명하는 투명한 백엔드 구조다.

### 1.2 그래프의 역할

```text
World generation
  -> WorldAsset 생성

Shot production
  -> 같은 월드 위에서 카메라, 배우, 소품, 조명으로 컷 촬영

Dependency / timeline
  -> 공유 참조, 영향 범위, 캐시 무효화, 재렌더링 관리
```

SceneForge에서 노드는 단순 계산 단위가 아니라 **제작 객체 + 제작 관계 + 제작 의도 + 캐시 의존성**을 함께 담는 상태 단위다.

---

## 2. 스코프와 참조 타입

### 2.1 Scope

- **Project scope**: 프로젝트 전체에서 공유되는 월드, 캐릭터, 룩, 기본 카메라 세팅
- **Sequence scope**: 한 시퀀스 안에서 공유되는 조명, 무드, 세트 드레싱, 카메라 리그
- **Clip scope**: 특정 컷에서만 유효한 카메라 경로, 액션, 로컬 수정, 렌더 결과

### 2.2 Reference Type

- **Shared**: 같은 노드를 여러 컷이 직접 공유한다. 수정 시 연결된 컷에 모두 영향이 있다.
- **Instance**: 원본을 참조하되 일부 값만 컷별로 override한다.
- **Local**: 연결이 끊긴 독립 노드다.

사용자에게는 `Shared / Instance / Local`을 쉬운 배지로 보여준다. 저장 모델도 이 세 의미를 1급 필드로 다룬다.

---

## 3. 최소 노드 세트

PDF 기준 MVP는 풍부한 노드 카탈로그보다 다음 최소 세트를 먼저 구현한다.

### 3.1 Source Nodes

- **ImageSourceNode**: Lyra 2.0 월드 생성의 시작 이미지
- **PromptNode**: 월드 확장, 분위기, outpainting 지시
- **VideoSourceNode**: reference video, plate, motion reference
- **AssetSourceNode**: 캐릭터, 소품, 의상, 3D asset

### 3.2 World Nodes

- **WorldGenerateNode**
  - backend: `Lyra 2.0`
  - input: `ImageSourceNode + CameraTrajectoryNode + PromptNode(optional)`
  - output: `GeneratedSegmentNode`, `SpatialMemoryNode`, `WorldAssetNode`
- **GeneratedSegmentNode**: Lyra 2.0이 만든 long-horizon video segment와 생성 로그
- **WorldAssetNode**
  - 하나의 촬영 가능한 월드 패키지
  - visual layer: `3DGS`
  - simulation layer: `surface mesh / collision mesh / navmesh`
  - memory layer: `SpatialMemoryCache`
  - production overlay: actor marks, camera anchors, light sockets, prop sockets
- **WorldElementRefNode**
  - 월드 내부 craft 요소 참조
  - 예: actor_mark, camera_anchor, light_socket, prop_socket, walkable_zone

### 3.3 Memory Nodes

- **SpatialMemoryNode**
  - Lyra 2.0의 frame별 기억
  - `rgb`, `depth`, `camera pose`, `point cloud`, `retrieval index` 저장
- **MemoryRetrieveNode**
  - 현재 카메라 경로에서 필요한 과거 view를 검색
  - output: retrieved frames, coverage score, confidence map
- **CorrespondenceNode**
  - 과거 view와 현재 target view의 대응 관계
  - 배경 일관성 유지용 condition

### 3.4 Shot Nodes

- **CameraTrajectoryNode**
  - 월드 탐색 경로이자 촬영 카메라 경로
  - Lyra 2.0 generation input이면서 timeline clip의 camera path
- **CameraRigNode**: dolly, handheld, orbit, crane 등 리그 타입
- **LensNode**: focal length, sensor, DOF
- **LightingRigNode**: key, fill, rim, practical light
- **ActorPlacementNode**: 배우 위치, 방향, 시작 상태
- **PropPlacementNode**: 소품 위치, attachment, object ID
- **ActionBlockNode**: walk, sit, look_at, speak, pick_up 등 고수준 액션

### 3.5 Render / Output Nodes

- **StageRenderPassNode**
  - 3D stage에서 구조 고정용 render pass 생성
  - background RGB, actor RGB, prop RGB, depth, mask, normal, motion vector, object ID
- **GenerativeRefinementNode**
  - photoreal integration, lighting harmonization, edge cleanup, hole filling
  - 구조를 새로 만들지 않고 stage render를 보정
- **TimelineClipNode**
  - 타임라인 위의 컷
  - 참조 월드, 카메라 경로, 액션, 렌더 캐시, 그래프 snapshot을 가진다.
- **RenderCacheNode**
  - proxy / final render 결과
  - `valid`, `invalid`, `rendering`, `failed` 상태 관리

---

## 4. 세 개의 핵심 그래프

### 4.1 World Generation Graph

Lyra 2.0의 explorable world generation을 SceneForge `WorldAsset`으로 바꾸는 그래프다.

```text
ImageSourceNode
  ↓
CameraTrajectoryNode
  ↓
WorldGenerateNode(Lyra 2.0)
  ├─ output      → GeneratedSegmentNode(long-horizon video)
  ├─ update      → SpatialMemoryNode
  └─ reconstruct → WorldAssetNode(3DGS + mesh)
```

사용자에게 보여줄 것:

- 입력 이미지
- 월드 확장 경로
- 생성된 월드 버전
- 3DGS / mesh 생성 여부
- memory coverage
- 새로 생성된 영역과 기존 memory로 커버된 영역

숨길 것:

- DiT 내부 구조
- token layout
- correspondence injection 세부 구현
- 캐시 키와 내부 해시

### 4.2 Shot Production Graph

생성된 월드 위에서 실제 촬영하듯 컷을 만드는 그래프다.

```text
WorldAssetNode
  ├─ SpatialMemoryNode
  ├─ WorldElementRefNode(camera_anchor)
  ├─ ActorPlacementNode
  ├─ PropPlacementNode
  ├─ CameraRigNode + LensNode + CameraTrajectoryNode
  └─ LightingRigNode
       ↓
StageRenderPassNode
       ↓
MemoryRetrieveNode
       ↓
GenerativeRefinementNode
       ↓
TimelineClipNode
```

핵심 의미:

- `3DGS / mesh world` = 촬영 세트
- `SpatialMemoryNode` = 배경 일관성 기억
- `Actor / Prop / Light / Camera nodes` = 촬영 연출
- `StageRenderPassNode` = 구조 고정
- `GenerativeRefinementNode` = 포토리얼 보정
- `TimelineClipNode` = 결과 컷 + 재렌더 가능한 그래프 상태

### 4.3 Dependency / Timeline Graph

공유 노드 수정 시 어떤 컷이 영향을 받는지 보여주는 그래프다.

```text
Shared WorldAssetNode
  ├─ used by → TimelineClipNode_001
  ├─ used by → TimelineClipNode_002
  └─ used by → TimelineClipNode_003

Shared LightingRigNode
  ├─ used by → TimelineClipNode_002
  └─ used by → TimelineClipNode_003

CameraTrajectoryNode changed
  ↓
GeneratedSegment invalid
  ↓
RenderCache invalid
  ↓
TimelineClip needs rerender
```

필수 UX:

- Reveal References
- 영향받는 컷 목록
- 다시 렌더될 범위
- Shared / Instance / Local 배지
- Break Link / Make Local
- proxy / final cache 상태

---

## 5. 사용자에게 보여줄 것과 숨길 것

### 5.1 보여줄 것

- 이 컷은 어떤 월드, 캐릭터, 룩을 공유 중인지
- 어떤 노드가 shared이고 어떤 노드가 local인지
- 변경 시 어떤 컷이 영향을 받는지
- 현재 카메라 경로의 memory coverage
- 새로 생성해야 하는 영역과 기존 memory로 유지되는 영역
- proxy / final render cache 상태

문장형 상태 예시:

- 이 컷은 `CafeWorld_v03`, `Hero_v02`, `WarmNightLook`을 공유 중입니다.
- 카메라 경로의 78%는 기존 `SpatialMemory`로 커버됩니다.
- 조명 노드를 수정하면 3개 컷이 다시 렌더링됩니다.

### 5.2 숨길 것

- 내부 캐시 키
- 중복 제거 로직
- scheduler
- DiT attention 구조
- low-level dependency hash
- 모델 내부 memory injection 방식

---

## 6. 핵심 UX 플로우

### 6.1 월드 생성

사용자: 이미지 1장을 넣고 카메라 경로를 그린다.

시스템:

1. `ImageSourceNode` 생성
2. `CameraTrajectoryNode` 생성
3. `WorldGenerateNode` 실행
4. `GeneratedSegmentNode` 저장
5. `SpatialMemoryNode` 업데이트
6. 3DGS / mesh를 `WorldAssetNode`에 저장

결과: 하나의 재사용 가능한 촬영 월드가 생성된다.

### 6.2 월드에서 컷 촬영

사용자: 생성된 월드에 배우와 소품을 넣고 카메라로 촬영한다.

시스템:

1. `ActorPlacementNode` / `PropPlacementNode` 생성
2. `CameraRigNode` / `LensNode` / `LightingRigNode` 연결
3. `StageRenderPassNode` 생성
4. `SpatialMemoryNode`에서 배경 reference retrieve
5. `GenerativeRefinementNode` 실행
6. `TimelineClipNode` 생성

결과: 타임라인에 컷이 생기고, 해당 컷은 월드·배우·카메라·조명 그래프를 참조한다.

### 6.3 공유 노드 수정과 부분 재렌더링

사용자: 공유 조명 노드를 수정한다.

시스템:

1. 해당 `LightingRigNode`를 참조하는 컷 검색
2. 영향받는 `TimelineClipNode` 목록 표시
3. 관련 `RenderCacheNode`를 invalid 처리
4. 사용자가 승인하면 affected clips만 rerender

결과: 전체 영상을 다시 만들지 않고, 변경된 노드와 연결된 컷만 다시 생성한다.

---

## 7. UI와 노드 시스템 연결

### Composer / Timeline

- `TimelineClipNode`를 시간축 위의 1급 객체로 보여준다.
- 각 컷의 `Shared / Instance / Local` 상태, proxy/final cache 상태, rerender 필요 여부를 표시한다.
- 플레이헤드 스크럽 시 해당 시점의 `CameraTrajectoryNode`, `StageRenderPassNode`, `RenderCacheNode`를 동기화한다.

### Stage Viewer

- `WorldAssetNode`의 3DGS / mesh / overlay를 표시한다.
- actor marks, camera anchors, light sockets, prop sockets를 `WorldElementRefNode`로 노출한다.
- 배우·소품·조명·카메라 조작은 각각 placement, rig, trajectory 노드로 기록된다.

### Graph Editor

- 기본은 현재 컷의 핵심 서브그래프만 보여준다.
- 전체 노드 카탈로그는 고급 모드로 숨긴다.
- 사용자는 노드 타입 이름보다 "이 컷이 무엇을 공유하는지", "어떤 변경이 어디에 영향을 주는지"를 먼저 본다.

### Inspector / Library

- 선택 노드의 배지: `Shared`, `Instance`, `Local`
- 명령: `Reveal References`, `Break Link`, `Make Local`, `Override Value`
- 라이브러리 대상: world, character, look, camera rig, lighting rig, prop set

### Chat Assistant

- 자연어 의도를 노드 생성·연결 작업으로 번역한다.
- 예: "이 이미지로 카페 월드를 만들고 오른쪽으로 카메라를 이동해줘" -> `ImageSourceNode`, `CameraTrajectoryNode`, `WorldGenerateNode`
- 예: "이 조명 세팅을 다음 컷에도 써줘" -> `LightingRigNode`를 `Shared` 참조로 연결

---

## 8. 캐시와 invalidation 규칙

- `WorldAssetNode`가 바뀌면 해당 월드를 참조하는 컷의 stage/render cache를 invalid 처리한다.
- `SpatialMemoryNode`가 갱신되면 memory coverage와 retrieval result를 재계산한다.
- `CameraTrajectoryNode`가 바뀌면 generated segment, stage pass, render cache가 downstream invalid 된다.
- `LightingRigNode`가 shared 상태로 바뀌면 해당 노드를 쓰는 모든 컷의 affected list를 표시한다.
- `GenerativeRefinementNode`만 바뀌면 구조 cache는 유지하고 refinement/final render만 다시 실행한다.
- 현재 플레이헤드 주변 컷과 visible timeline range를 proxy render queue에서 우선 처리한다.

---

## 9. MVP 우선순위

### P1. 참조와 일관성

- `WorldAssetNode`
- `SpatialMemoryNode`
- `CameraTrajectoryNode`
- `TimelineClipNode`
- `RenderCacheNode`
- `Shared / Instance / Local` 배지
- Reveal References
- 영향받는 컷 표시

### P1. Lyra 2.0 WorldAsset 연결

- `ImageSourceNode -> WorldGenerateNode -> WorldAssetNode`
- `GeneratedSegmentNode` 저장
- 3DGS / mesh output path 저장
- SpatialMemory path 저장

### P2. 월드 위 촬영

- `ActorPlacementNode`
- `PropPlacementNode`
- `CameraRigNode`
- `LensNode`
- `LightingRigNode`
- `StageRenderPassNode`
- `GenerativeRefinementNode`

### P2. 부분 재렌더링

- `RenderCacheNode` invalidation
- affected clip list
- proxy / final render queue

---

## 10. 최종 요약

SceneForge의 노드 그래프는 복잡한 생성 모델 구조를 보여주는 화면이 아니다.

핵심은 다음 세 가지다.

1. Lyra 2.0으로 explorable world를 생성한다.
   `image + camera trajectory -> video + spatial memory + 3DGS/mesh`
2. 생성된 `WorldAsset`을 여러 컷에서 공유한다.
   같은 월드, 캐릭터, 룩, 카메라 세팅을 참조한다.
3. 변경된 노드와 연결된 컷만 다시 렌더링한다.
   참조 그래프가 영향 범위와 render cache invalidation을 관리한다.

사용자에게는 이렇게 보여주면 된다.

- 같은 세계를 유지한 채 필요한 부분만 고친다.
- 어떤 컷이 무엇을 공유하는지 보인다.
- 바뀐 부분과 연결된 컷만 다시 렌더링된다.
