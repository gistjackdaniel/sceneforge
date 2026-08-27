# SceneForge Cursor 작업 문서

> **Cursor Rules:** 코드·UI 작성 시 [.cursor/rules/sceneforge-overview.mdc](.cursor/rules/sceneforge-overview.mdc), [.cursor/rules/sceneforge-node-graph.mdc](.cursor/rules/sceneforge-node-graph.mdc), [.cursor/rules/sceneforge-editor-ui.mdc](.cursor/rules/sceneforge-editor-ui.mdc)를 따른다.

## 0. 한 줄 정의

SceneForge는 **타임라인 기반 제작 IDE** 위에서 Lyra 2.0이 만든 explorable world를 `WorldAsset`으로 받아오고, 그 월드·자산·룩·카메라 세팅을 여러 컷에서 공유하며, 변경된 노드와 연결된 컷만 다시 렌더링하는 시스템이다.

Lyra 2.0의 역할:

```text
image + camera trajectory
  -> long-horizon video
  -> SpatialMemoryCache
  -> 3DGS / surface mesh
```

SceneForge의 역할:

```text
WorldAsset
  -> Shared node references
  -> Shot production graph
  -> Timeline render cache
  -> Partial rerender
```

---

## 1. 제품 핵심 철학

### 1.1 그래프는 사용자가 조립하는 복잡한 화면이 아니다

- 그래프는 제작 상태와 의존성을 설명하는 백엔드 구조다.
- 사용자는 "이 컷이 무엇을 공유하는지", "무엇을 바꾸면 어떤 컷이 다시 렌더링되는지"를 이해하면 된다.
- 노드 타입 선택보다 타임라인, 스테이지 조작, 챗봇 의도 입력이 기본 진입점이다.

### 1.2 Timeline + World + Shot Graph

- 타임라인은 사용자의 메인 작업 공간이다.
- 월드는 장면 일관성의 근원이며, 여러 컷에서 재사용되는 촬영 세트다.
- 각 타임라인 컷은 단순 비디오 파일이 아니라 월드·카메라·배우·소품·조명·렌더 캐시를 참조하는 그래프 상태다.
- 공유 대상은 컷 전체가 아니라 컷을 구성하는 개별 노드다.

### 1.3 Lyra 2.0 WorldAsset-first

- 월드 생성은 Lyra 2.0 백엔드가 담당한다.
- SceneForge는 Lyra 2.0의 결과물인 long-horizon video, SpatialMemoryCache, 3DGS, surface mesh를 `WorldAssetNode`로 패키징한다.
- 이후의 제작은 생성 모델 내부 구조가 아니라 `WorldAsset`, `SpatialMemory`, `CameraTrajectory`, `RenderCache`의 참조와 상태를 중심으로 다룬다.

### 1.4 부분 재렌더링이 핵심 가치다

- 한 번 만든 월드와 룩을 여러 컷에서 공유한다.
- 공유 노드를 수정하면 affected clip list를 먼저 보여준다.
- 사용자가 승인하면 변경된 노드와 연결된 컷만 proxy/final render queue에 넣는다.

---

## 2. 최종 UX 컨셉

### 2.1 Composer / Timeline Panel

- Premiere Pro 스타일 타임라인
- empty clip 추가
- 실제 영상 클립 import는 후속 확장
- trim / split / reorder / retime
- 각 컷의 linked world, shared badge, cache status, rerender needed 상태 표시

### 2.2 Chat Assistant Panel

우측 고정 패널. 자연어를 노드 생성·연결 작업으로 번역한다.

예시:

- 이 이미지로 카페 월드를 만들고 오른쪽으로 카메라를 이동해줘.
- 이 조명 세팅을 다음 컷에도 공유해줘.
- 이 컷의 카메라 경로가 기존 memory로 얼마나 커버되는지 보여줘.
- 이 노드를 수정하면 어떤 컷이 다시 렌더링되는지 보여줘.

### 2.3 World Generation Panel

- 시작 이미지와 optional prompt 입력
- 카메라 경로 그리기
- Lyra 2.0 `WorldGenerateNode` 실행 상태 표시
- GeneratedSegment, SpatialMemory, 3DGS / mesh output path 표시
- memory coverage와 새로 생성된 영역 표시

### 2.4 Stage Viewer

- `WorldAssetNode`의 3DGS / mesh / production overlay 표시
- actor marks, camera anchors, light sockets, prop sockets 표시
- 배우, 소품, 조명, 카메라를 실제 촬영 세트처럼 배치
- 조작 결과를 placement, rig, trajectory 노드로 기록

### 2.5 Graph Editor + Inspector + Library

- 기본은 현재 컷의 핵심 서브그래프만 보여준다.
- 사용자-facing 참조 상태는 `Shared / Instance / Local` 배지로 통일한다.
- Inspector 명령: `Reveal References`, `Break Link`, `Make Local`, `Override Value`
- Library 대상: world, character, prop, look, camera rig, lighting rig

---

## 3. 핵심 데이터 모델

### 3.1 Project

- `id`
- `name`
- `sequences`
- `world_assets`
- `shared_nodes`
- `render_cache_index`

### 3.2 Sequence

- `id`
- `name`
- `timeline_clips`
- sequence-scope shared looks, lighting rigs, camera rigs

### 3.3 TimelineClip

타임라인 컷은 구간 container이자 그래프 진입점이다.

- `id`
- `name`
- `start`
- `end`
- `duration`
- `source_type = empty | generated | video`
- `clipgraph_id`
- `linked_world_id`
- `camera_trajectory_node_id`
- `render_cache_node_id`
- `graph_snapshot_id`
- `cache_status = valid | invalid | rendering | failed`

### 3.4 NodeBase

- `node_id`
- `type`
- `name`
- `scope = project | sequence | clip`
- `reference_type = shared | instance | local`
- `enabled`
- `tags`
- `version`
- `created_at`
- `updated_at`

### 3.5 NodeReference

- `from_node_id`
- `to_node_id`
- `reference_type = shared | instance | local`
- `override_patch(optional)`
- `dependency_role`
- `invalidates`

### 3.6 WorldAsset

Lyra 2.0 결과를 SceneForge 촬영 세트로 패키징한다.

- `world_id`
- `source_image_node_id`
- `world_generate_node_id`
- `generated_segment_node_id`
- `spatial_memory_node_id`
- `visual_layer_3dgs_path`
- `surface_mesh_path`
- `collision_mesh_path`
- `navmesh_path`
- `production_overlay`
  - actor marks
  - camera anchors
  - light sockets
  - prop sockets
  - walkable zones
- `versions`

### 3.7 RenderCache

- `render_cache_node_id`
- `clip_id`
- `quality = proxy | final`
- `status = valid | invalid | rendering | failed`
- `artifact_path`
- `dependency_hash`
- `invalidated_by_node_ids`
- `created_at`
- `updated_at`

---

## 4. 노드 시스템

### 4.1 Source Nodes

- **ImageSourceNode**: Lyra 2.0 월드 생성의 시작 이미지
- **PromptNode**: 월드 확장, 분위기, outpainting 지시
- **VideoSourceNode**: reference video, plate, motion reference
- **AssetSourceNode**: 캐릭터, 소품, 의상, 3D asset

### 4.2 World Nodes

- **WorldGenerateNode**
  - backend: `Lyra 2.0`
  - input: `ImageSourceNode + CameraTrajectoryNode + PromptNode(optional)`
  - output: `GeneratedSegmentNode`, `SpatialMemoryNode`, `WorldAssetNode`
- **GeneratedSegmentNode**: long-horizon video segment
- **WorldAssetNode**: 3DGS, mesh, SpatialMemory, production overlay를 묶은 촬영 월드
- **WorldElementRefNode**: actor_mark, camera_anchor, light_socket, prop_socket, walkable_zone 등 월드 내부 craft 요소

### 4.3 Memory Nodes

- **SpatialMemoryNode**: rgb, depth, camera pose, point cloud, retrieval index 저장
- **MemoryRetrieveNode**: 현재 카메라 경로에서 필요한 과거 view 검색, coverage score 산출
- **CorrespondenceNode**: 과거 view와 target view의 대응 관계, 배경 일관성 유지용 condition

### 4.4 Shot Nodes

- **CameraTrajectoryNode**: Lyra 2.0 generation input이자 timeline clip camera path
- **CameraRigNode**: dolly, handheld, orbit, crane
- **LensNode**: focal length, sensor, DOF
- **LightingRigNode**: key, fill, rim, practical
- **ActorPlacementNode**: 배우 위치, 방향, 시작 상태
- **PropPlacementNode**: 소품 위치, attachment, object ID
- **ActionBlockNode**: walk, sit, look_at, speak, pick_up

### 4.5 Render / Output Nodes

- **StageRenderPassNode**: background RGB, actor RGB, prop RGB, depth, mask, normal, motion vector, object ID
- **GenerativeRefinementNode**: photoreal integration, lighting harmonization, edge cleanup, hole filling
- **TimelineClipNode**: 참조 월드, 카메라 경로, 액션, 렌더 캐시, graph snapshot을 가진 컷
- **RenderCacheNode**: proxy / final render 결과와 상태

---

## 5. 세 개의 핵심 그래프

### 5.1 World Generation Graph

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

### 5.2 Shot Production Graph

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

### 5.3 Dependency / Timeline Graph

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

---

## 6. 핵심 UX 플로우

### 6.1 월드 생성

1. 사용자가 이미지 1장을 넣고 카메라 경로를 그린다.
2. 시스템이 `ImageSourceNode`와 `CameraTrajectoryNode`를 만든다.
3. `WorldGenerateNode(Lyra 2.0)`를 실행한다.
4. `GeneratedSegmentNode`를 저장한다.
5. `SpatialMemoryNode`를 업데이트한다.
6. 3DGS / mesh를 `WorldAssetNode`에 저장한다.
7. 생성된 월드는 project/sequence/clip scope에서 참조 가능해진다.

### 6.2 월드에서 컷 촬영

1. 사용자가 생성된 월드에 배우와 소품을 넣고 카메라로 촬영한다.
2. 시스템이 `ActorPlacementNode` / `PropPlacementNode`를 만든다.
3. `CameraRigNode` / `LensNode` / `LightingRigNode`를 연결한다.
4. `StageRenderPassNode`를 생성한다.
5. `SpatialMemoryNode`에서 배경 reference를 retrieve한다.
6. `GenerativeRefinementNode`를 실행한다.
7. `TimelineClipNode`와 `RenderCacheNode`를 생성한다.

### 6.3 공유 노드 수정과 부분 재렌더링

1. 사용자가 shared 조명 노드를 수정한다.
2. 시스템이 해당 `LightingRigNode`를 참조하는 컷을 검색한다.
3. 영향받는 `TimelineClipNode` 목록과 다시 렌더될 범위를 표시한다.
4. 관련 `RenderCacheNode`를 invalid 처리한다.
5. 사용자가 승인하면 affected clips만 rerender한다.

---

## 7. UI 요구사항

### Timeline

- Add Empty Clip
- Import Video Clip은 후속 확장으로 유지
- 선택된 컷의 linked world 표시
- `Shared / Instance / Local` 배지 표시
- proxy/final cache 상태 표시
- rerender needed 상태 표시

### World Generation

- 이미지 입력
- optional prompt 입력
- camera trajectory drawing
- Lyra 2.0 job status
- GeneratedSegment / SpatialMemory / 3DGS / mesh artifact path 표시
- memory coverage 표시

### Stage Viewer

- 3DGS / mesh world preview
- actor placement
- prop placement
- camera trajectory editing
- light gizmo
- production overlay toggle

### Graph Editor

- 현재 컷의 서브그래프 표시
- World Generation Graph, Shot Production Graph, Dependency Graph 전환
- shared node reveal
- affected clips preview

### Inspector

- 선택 노드 파라미터 편집
- `Shared / Instance / Local` 상태 표시
- `Break Link`
- `Make Local`
- `Reveal References`
- `Override Value`

### Library

- project/sequence scope 노드 라이브러리
- world, character, prop, look, camera rig, lighting rig 저장
- 다른 컷으로 shared 또는 instance 참조 연결

---

## 8. 캐시 및 재렌더 규칙

### 캐시 종류

- proxy render cache
- final render cache
- per-clip cache
- optional per-node evaluation cache
- generated segment cache
- spatial memory cache
- stage render pass cache

### invalidation 규칙

- `WorldAssetNode` 변경 시 해당 월드를 참조하는 모든 컷의 stage/render cache invalid
- `SpatialMemoryNode` 갱신 시 memory retrieve result와 coverage score 재계산
- `CameraTrajectoryNode` 변경 시 generated segment, stage render pass, render cache downstream invalid
- `LightingRigNode` 변경 시 해당 노드를 참조하는 컷의 render cache invalid
- `GenerativeRefinementNode` 변경 시 구조 cache는 유지하고 refinement/final render만 invalid
- `RenderCacheNode` 상태는 `valid`, `invalid`, `rendering`, `failed` 중 하나로 관리

### 렌더 우선순위

- 현재 플레이헤드 주변 컷 우선
- visible timeline range 우선
- shared node 수정으로 invalid된 affected clips 우선
- background low-priority render queue

---

## 9. 현실적인 MVP 우선순위

### P1. 참조와 일관성

목표: timeline + clipgraph + shared node reference의 최소 동작.

포함:

- `WorldAssetNode`
- `SpatialMemoryNode`
- `CameraTrajectoryNode`
- `TimelineClipNode`
- `RenderCacheNode`
- `Shared / Instance / Local` 배지
- Reveal References
- 영향받는 컷 표시
- proxy render cache 상태

### P1. Lyra 2.0 WorldAsset 연결

목표: Lyra 2.0의 결과를 SceneForge 월드 에셋으로 패키징.

포함:

- `ImageSourceNode -> WorldGenerateNode -> WorldAssetNode`
- `GeneratedSegmentNode` 저장
- 3DGS / mesh output path 저장
- SpatialMemory path 저장
- memory coverage 표시

### P2. 월드 위 촬영

목표: 생성된 월드에서 실제 촬영하듯 컷 제작.

포함:

- `ActorPlacementNode`
- `PropPlacementNode`
- `CameraRigNode`
- `LensNode`
- `LightingRigNode`
- `StageRenderPassNode`
- `GenerativeRefinementNode`
- `TimelineClipNode` 생성

### P2. 부분 재렌더링

목표: 변경된 노드와 연결된 컷만 다시 렌더링.

포함:

- `RenderCacheNode` invalidation
- affected clip list
- proxy / final render queue
- rerender approval UI

### Future. 실제 영상 클립과 동적 재구성

- `VideoSourceNode` 기반 reference video / plate / motion reference
- camera path estimation
- background reconstruction
- dynamic scene reconstruction은 별도 optional module로 둔다.

---

## 10. 구현 메모

### 우선 만들 파일/모듈

```text
apps/editor/
  src/
    app/
    panels/timeline/
    panels/world-generation/
    panels/stage/
    panels/graph/
    panels/inspector/
    panels/library/
    panels/chat/
    state/
    core/
      project/
      timeline/
      clipgraph/
      nodes/
      references/
      dependency/
      cache/
      world/
      lyra/
      render/
```

### 핵심 타입 예시

```ts
Project
Sequence
TimelineClip
ClipGraph
NodeBase
NodeReference
ImageSourceNode
PromptNode
CameraTrajectoryNode
WorldGenerateNode
GeneratedSegmentNode
SpatialMemoryNode
MemoryRetrieveNode
CorrespondenceNode
WorldAssetNode
WorldElementRefNode
StageRenderPassNode
GenerativeRefinementNode
TimelineClipNode
RenderCacheNode
```

### 구현 순서

1. Project, Sequence, TimelineClip, ClipGraph 최소 모델
2. NodeBase, NodeReference, `Shared / Instance / Local` 저장 모델
3. RenderCacheNode와 cache status UI
4. Lyra 2.0 World Generation Graph 타입과 job adapter stub
5. WorldAsset artifact registry: generated segment, spatial memory, 3DGS, mesh path
6. Stage Viewer와 WorldAsset preview 연결
7. Shot Production Graph: actor/prop placement, camera rig, lens, lighting
8. MemoryRetrieveNode / CorrespondenceNode / StageRenderPassNode / GenerativeRefinementNode stub
9. Dependency Graph: Reveal References, affected clips, invalidation
10. Partial rerender queue: proxy/final cache 재생성

---

## 11. 비기능 요구사항

- 진입점은 script가 아니라 timeline이다.
- 그래프는 사용자가 직접 노드를 모두 조립하는 화면이 아니라 제작 상태를 설명하는 투명한 구조다.
- 월드 생성은 Lyra 2.0 backend adapter로 분리한다.
- 결과물보다 재현 가능한 recipe와 dependency graph가 1급 객체다.
- 모든 변경은 dependency graph를 따라 추적 가능해야 한다.
- 사용자는 shared node 수정 시 affected clips를 먼저 확인해야 한다.
- 캐시는 proxy/final을 분리하고, 변경된 downstream만 invalid 처리한다.

---

## 12. 최종 목표 문장

**SceneForge는 타임라인 위에서 영상을 편집하지만, 실제로는 Lyra 2.0으로 생성한 월드와 그 위의 제작 그래프를 평가해 결과를 얻는 시스템이다.**

즉,

- Lyra 2.0은 explorable world를 만든다.
- SceneForge는 그 월드를 여러 컷에서 공유 가능한 `WorldAsset`으로 관리한다.
- 컷은 비디오 파일이 아니라 재렌더 가능한 그래프 상태다.
- 사용자는 무엇이 공유되는지 보고, 필요한 부분만 고친다.
- 바뀐 노드와 연결된 컷만 다시 렌더링된다.
