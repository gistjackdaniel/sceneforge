# SceneForge PRD — 통합 개발 계획서

> **문서 지위**
> 이 문서는 다음 문서들을 하나로 통합한 SceneForge의 단일 기준 문서다.
>
> - Core Technology Reference (기술 기준)
> - [blueprint_sceneforge.md](blueprint_sceneforge.md) (제품 청사진·UX)
> - [node_graph_architecture.md](node_graph_architecture.md) (노드 그래프 설계)
> - [sceneforge_구현_계획_5058a615.plan.md](sceneforge_구현_계획_5058a615.plan.md) (구현 계획)
>
> 기능을 구현하거나 데이터 구조를 수정할 때 이 문서를 우선 참조한다.
> 문서 간 충돌은 [§19 문서 조정 결정](#19-문서-조정-결정)에 기록된 대로 해소했다.

---

## 0. Product Definition

SceneForge는 단순한 AI 비디오 생성기가 아니다.

SceneForge는 **지속적으로 유지되는 월드 상태를 여러 컷이 공유하고, 월드·자산·카메라·조명·동작을 노드 그래프로 관리하며, 변경된 부분만 다시 생성하는 AI 영상 제작 IDE**다.

```text
Prompt / Image / Video / 3D Asset
                ↓
        Persistent World
                ↓
   Camera · Actor · Light · Motion
                ↓
      Reusable Node Graph
                ↓
        Timeline / Shot Edit
                ↓
   Proxy Render → Final Render
```

```text
Project
├── Persistent World
├── Shared Asset Library
├── Project Graph
├── Sequence Graphs
├── Clip Graphs
├── Timeline
└── Render Cache
```

SceneForge의 경쟁력은 특정 생성 모델의 성능이 아니라 다음 능력에서 나온다.

1. 동일한 월드와 자산을 여러 컷에서 재사용한다.
2. 컷을 구성하는 노드가 다른 컷에서도 참조될 수 있다.
3. 노드 간 의존성과 변경 영향을 추적한다.
4. 변경된 요소가 영향을 주는 컷만 다시 계산한다.
5. 3D Viewport의 조작을 재현 가능한 그래프로 저장한다.
6. 생성 모델을 교체 가능한 렌더 백엔드로 취급한다.

### 0.1 제품 철학 (blueprint 계승)

1. **진입점은 timeline** — 노드 카탈로그나 script가 아니다. 타임라인, 스테이지 조작, 챗 의도 입력이 기본이다.
2. **그래프는 백엔드 구조** — 사용자가 노드를 직접 조립하는 화면이 아니다. 제작 상태·의존성을 설명하는 투명한 구조다.
3. **WorldAsset-first** — 생성 백엔드(현재 Lyra 2.0)의 결과를 `WorldAsset`으로 패키징한다. 생성 모델 내부(DiT, token layout, correspondence injection)는 노출하지 않는다.
4. **부분 재렌더링이 핵심 가치** — shared 노드 수정 시 affected clip list를 **먼저** 보여주고, 승인 후 proxy/final queue에 넣는다.
5. **recipe > artifact** — 재현 가능한 recipe와 dependency graph가 1급 객체다.

### 0.2 최종 목표 문장

**SceneForge는 타임라인 위에서 영상을 편집하지만, 실제로는 생성된 지속적 월드와 그 위의 제작 그래프를 평가해 결과를 얻는 시스템이다.**

- 생성 백엔드(Lyra 2.0)는 explorable world를 만든다.
- SceneForge는 그 월드를 여러 컷에서 공유 가능한 `WorldAsset`으로 관리한다.
- 컷은 비디오 파일이 아니라 재렌더 가능한 그래프 상태다.
- 사용자는 무엇이 공유되는지 보고, 필요한 부분만 고친다.
- 바뀐 노드와 연결된 컷만 다시 렌더링된다.

---

## 1. Core Technical Priorities

```text
P0. Persistent World Representation
P1. Node Reference and Dependency Engine
P2. Asset Identity and World Memory
P3. Stage Viewer to Graph Mapping
P4. Timeline and Clip Graph Synchronization
P5. Incremental Rendering and Cache
P6. Model Connector and Condition Normalization
P7. Generative World Model Integration
```

생성 모델 연동보다 **월드, 그래프, 참조, 캐시 구조를 먼저 구현한다.**
Lyra 2.0 실연동은 P7(=구현 로드맵 Phase 6)이며, 그 전까지는 stub connector와 샘플 `WorldAsset`으로 개발한다.

---

## 2. Persistent World Representation

### 2.1 핵심 개념

월드는 단순한 렌더 입력이나 특정 카메라 시점이 아니라, 프로젝트 전체에서 유지되는 상태 저장소다.

```text
World
├── Environment
├── Actors
├── Props
├── Lights
├── Cameras
├── Object Identity
├── Spatial Relationships
├── Materials
├── Animation and Motion
├── Semantic Metadata
└── Proxy Representation
```

```text
World ≠ Rendered Video
World ≠ Single Camera View
World ≠ One Clip

World = Reusable Project State
```

### 2.2 필수 요구사항

- 모든 월드 객체는 안정적인 전역 ID를 가진다.
- 컷마다 월드를 통째로 복제하지 않는다. 컷은 월드를 참조하고 필요한 값만 override한다.
- 월드 상태는 저장 및 복원이 가능해야 하며, 렌더 결과와 분리한다.
- 카메라가 보지 않는 영역도 월드 상태에서 제거하지 않는다.
- 월드 표현을 특정 생성 모델에 종속시키지 않는다. Mesh, point cloud, 3DGS, image-based proxy를 공통 인터페이스 뒤에 둔다.

### 2.3 WorldAssetManifest

```ts
type WorldRepresentation =
  | "usd_stage"
  | "mesh"
  | "point_cloud"
  | "gaussian_splat"
  | "image_based_proxy"
  | "video_based_proxy"
  | "hybrid";

interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

interface WorldAssetManifest {
  id: string;
  name: string;

  representation: WorldRepresentation;

  sourceAssetIds: string[];
  rootUri: string;
  previewUri?: string;

  coordinateSystem: "Y_UP" | "Z_UP";
  unitScaleMeters: number;

  bounds?: BoundingBox;
  semanticTags: string[];

  generatedBy?: ModelExecutionRecord;

  version: number;
  createdAt: string;
  updatedAt: string;
}
```

### 2.4 Lyra 2.0 월드 레이어 (구체화)

Lyra 2.0 backend가 생성하는 `WorldAsset`은 위 manifest의 `representation: "hybrid"` 구현체이며, 다음 레이어를 `rootUri` 아래 artifact로 가진다.

- **visual layer**: 3DGS (`visual_layer_3dgs_path`)
- **simulation layer**: surface mesh / collision mesh / navmesh
- **memory layer**: SpatialMemoryCache (rgb, depth, camera pose, point cloud, retrieval index)
- **production overlay**: actor marks, camera anchors, light sockets, prop sockets, walkable zones
- **versions**: 월드 확장·재생성 이력

이 레이어 구성은 Lyra connector가 채우는 구현 세부이며, Core Domain은 manifest 공통 인터페이스만 본다.

### 2.5 World Layer와 Shot Override

프로젝트의 기본 월드를 직접 수정하지 않고 layer와 override를 사용한다.

```text
Master World
    ↓
Sequence Override
    ↓
Clip Override
    ↓
Resolved Shot State
```

예:

```text
Master World      — 낮 시간대, 기본 가구 배치, Hero 기본 의상
Sequence Override — 밤 조명, 창문 비 활성화
Clip Override     — Hero 위치 변경, 테이블 위 컵 추가
```

Clip Override는 다른 컷의 월드 상태를 손상시키면 안 된다.

---

## 3. Asset Identity and World Memory

### 3.1 Asset 정의

Asset은 여러 컷과 그래프에서 재사용할 수 있는 데이터다. **Asset과 Node는 다른 개념이다.**

```text
Asset = 재사용 가능한 데이터
Node  = Asset과 파라미터를 이용해 결과를 계산하는 연산 단위
```

```ts
type AssetType =
  | "image"
  | "video"
  | "audio"
  | "mesh"
  | "material"
  | "texture"
  | "actor"
  | "prop"
  | "environment"
  | "animation"
  | "camera_preset"
  | "lighting_preset"
  | "world"
  | "generated_proxy";

interface AssetRecord {
  id: string;
  type: AssetType;
  name: string;

  uri: string;
  thumbnailUri?: string;

  contentHash: string;
  metadata: Record<string, unknown>;
  semanticTags: string[];

  version: number;
  parentVersionId?: string;

  createdAt: string;
  updatedAt: string;
}
```

예:

```text
HeroCharacterAsset      ← Asset (캐릭터 자체)
        ↓
ActorPlacementNode      ← Node (특정 컷에서의 배치)
        ↓
CostumeOverrideNode
        ↓
Clip Render
```

### 3.2 World Memory 필수 조건

- 객체 이름이 아닌 ID로 참조한다.
- 동일 객체의 identity를 컷 간 유지한다.
- transform, parent, attachment 관계를 저장한다.
- 기본 appearance와 컷별 override를 분리한다.
- 생성된 자산도 일반 Asset처럼 저장한다.
- 생성 결과와 함께 입력, seed, model version을 `ModelExecutionRecord`로 기록한다.

---

## 4. Node Graph Architecture

### 4.1 Graph의 역할

Node Graph는 단순한 시각적 UI가 아니다. 노드는 **제작 객체 + 제작 관계 + 제작 의도 + 캐시 의존성**을 함께 담는 상태 단위다.

```text
Scene Definition
+ Asset Reference
+ Cinematic Direction
+ Model Conditions
+ Render Configuration
+ Dependency Tracking
```

각 컷은 결과 영상만 저장하는 것이 아니라, 결과를 재현할 수 있는 그래프와 캐시를 가진다.

```text
WorldReferenceNode
    ↓
PlacementNode
    ↓
CameraRigNode
    ↓
LightingRigNode
    ↓
RenderNode
    ↓
PostProcessNode
    ↓
Clip Cache
```

### 4.2 기본 Node / Edge 구조

```ts
type NodeScope = "clip" | "sequence" | "project";

type NodeStatus =
  | "clean"
  | "dirty"
  | "running"
  | "failed"
  | "disabled";

interface PortDefinition {
  id: string;
  name: string;
  dataType: string;
  required: boolean;
  multiple: boolean;
}

interface GraphNode<TParams = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;

  scope: NodeScope;
  name: string;

  params: TParams;

  inputPorts: PortDefinition[];
  outputPorts: PortDefinition[];

  status: NodeStatus;
  contentHash?: string;

  createdAt: string;
  updatedAt: string;
}

type EdgeKind =
  | "data"
  | "reference"
  | "dependency"
  | "control"
  | "temporal";

interface GraphEdge {
  id: string;

  sourceNodeId: string;
  sourcePort: string;

  targetNodeId: string;
  targetPort: string;

  kind: EdgeKind;
}
```

### 4.3 Graph 기본 규칙

- Graph는 DAG를 기본으로 한다. 순환 참조는 저장 전에 차단한다.
- 실행 순서는 위상 정렬로 계산한다.
- Node는 안정적인 전역 ID를 가진다.
- Node 출력은 입력 hash와 params hash로 식별한다.
- Node 삭제 전 모든 참조 위치를 검사한다. 참조 중인 Node를 자동 cascade delete하지 않는다.
- UI상 Node 위치는 계산 결과와 캐시 키에 영향을 주지 않는다.
- Node params에는 직렬화 가능한 값만 저장한다.

---

## 5. Reference Model

컷을 구성하는 노드가 다른 컷에서 재사용되려면 참조 방식을 명확하게 구분해야 한다.

### 5.1 세 가지 관계

| 관계 | 저장 모델 (`ReferenceType`) | UI 배지 | 의미 |
|------|---------------------------|---------|------|
| Hard Link | `shared` | `Shared` | 여러 컷이 동일 Node 객체를 직접 참조. 원본 변경 시 모든 참조 대상 영향 |
| Instance | `instance` | `Instance` | 원본 참조 + 일부 파라미터만 로컬 override (`overridePatch`) |
| Copy | `local` | `Local` | 값을 복제한 뒤 원본과 연결 없음 (독립 노드) |

> 코드의 `ReferenceType = "shared" | "instance" | "local"`이 각각 Hard Link / Instance / Copy 의미와 1:1 대응한다. enum을 다시 rename하지 않는다.

```text
Hard Link (Shared)
ProjectLookNode
 ├── Clip A
 ├── Clip B
 └── Clip C

Instance
BaseCameraRig
    ↓ instance
Clip B Camera
    └── focalLength override

Copy (Local)
Original Node
     ↓ copy
Independent Node
```

Hard Link 사용 예: 공통 캐릭터 Asset, 공통 환경, 공통 LUT, 공통 Lighting Rig, 공통 Render Preset.

### 5.2 NodeReference 구조

```ts
interface NodeReference {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  scope: NodeScope;
  referenceType: "shared" | "instance" | "local";
  overridePatch?: Record<string, unknown>;
  dependencyRole?: string;
  invalidates?: string[];
}
```

### 5.3 UI 용어

- 상태 배지: `Shared / Instance / Local`
- 복제 액션 메뉴: `링크 / 인스턴스 / 독립 복사` — 세 동작을 하나의 "복제" 기능으로 처리하지 않는다.
- Inspector 명령: `Reveal References`, `Break Link`, `Make Local`, `Override Value`

---

## 6. Graph Scope

| Scope | 용도 예시 |
|-------|-----------|
| `clip` | 컷 전용 Camera Path, Actor Motion, Lighting Override, Post Process |
| `sequence` | 동일 공간, 시퀀스 공통 배우 상태, 공통 시간대·조명, 시퀀스 공통 Look |
| `project` | Character Asset, Master World, 공통 LUT, 기본 Render Preset, 공통 Style |

### Scope 변경 규칙

- Clip Node를 다른 Clip에서 사용하면 scope 승격을 제안한다.
- scope 승격 시 기존 ID를 유지한다.
- scope 하향 전 외부 참조 존재 여부를 검사한다.
- 참조가 있는 Node를 Clip Scope로 임의 하향하지 않는다.

---

## 7. Node Taxonomy

### 7.1 표준 카탈로그 (Core Domain)

**A. Source Layer**

```text
TextSourceNode  ImageSourceNode  VideoSourceNode(Future)  AudioSourceNode
AssetReferenceNode  WorldReferenceNode
```

**B. Condition Layer**

```text
DepthConditionNode  PoseConditionNode  MaskConditionNode  MotionFieldNode
CameraConditionNode  StyleConditionNode  ReferenceConditionNode  ConditionBundleNode
```

**C. Scene Layer**

```text
PlacementNode  ActorPlacementNode  TransformNode  ConstraintNode
AttachmentNode  MaterialOverrideNode  PhysicsStateNode  SimulationCacheNode
```

**D. Cinematic Layer**

```text
CameraRigNode  CameraPathNode  LensNode  LightingRigNode
FramingRuleNode  ShotPresetNode  ObjectTrajectoryNode  ActionBlockNode
```

**E. Render and Post Layer**

```text
RenderSettingsNode  RenderBackendNode  VideoGenerationNode
ColorGradeNode  CompositingNode  ExportNode
```

Node Type에 모델 이름을 사용하지 않는다.

```text
❌ GEN3CNode, VeoNode, LyraNode
✅ ImageToWorldNode, NovelViewNode, CameraControlledRenderNode, VideoGenerationNode
```

### 7.2 기존(Lyra 특화) 노드 → 표준 카탈로그 매핑

| 기존 명칭 (blueprint/node_graph) | 통합 후 | 비고 |
|----------------------------------|---------|------|
| `CameraTrajectoryNode` | `CameraPathNode` | Lyra generation input이자 clip camera path. 단일 타입으로 통일 |
| `WorldGenerateNode(Lyra 2.0)` | `ImageToWorldNode` | 실제 모델은 Connector 설정으로 선택 (§12) |
| `WorldAssetNode` | `WorldAsset`(Asset) + `WorldReferenceNode`(Node) | Asset ≠ Node 분리 (§3.1) |
| `GeneratedSegmentNode` | `AssetRecord(type: "video")` + `ModelExecutionRecord` | 생성 결과는 Asset으로 등록 |
| `SpatialMemoryNode` | `WorldAsset` memory layer | Core Graph 노드가 아닌 월드 artifact. coverage %는 사용자-facing 메타데이터로 유지 |
| `MemoryRetrieveNode` / `CorrespondenceNode` | Lyra connector 내부 단계 (또는 `ReferenceConditionNode`) | 모델별 condition은 Core Graph에 직접 노출하지 않음 |
| `WorldElementRefNode` | 유지 | production overlay(actor mark, camera anchor 등) 참조 |
| `PropPlacementNode` | `PlacementNode` | Actor는 `ActorPlacementNode` 유지 |
| `StageRenderPassNode` | 유지 (Render layer) | 구조 고정용 pass: background/actor/prop RGB, depth, mask, normal, motion vector, object ID |
| `GenerativeRefinementNode` | 유지 (Render layer) | photoreal integration, lighting harmonization — task 기반 이름이므로 적합 |
| `TimelineClipNode` | `TimelineClip` (Timeline 도메인 객체) | Clip은 노드가 아니라 Graph의 entry point (§10) |
| `RenderCacheNode` | `RenderCacheEntry` (Cache 도메인 객체) | 캐시는 노드가 아님 |
| `PromptNode` | `TextSourceNode` | |

기존 코드(`core/nodes/types.ts`)의 중복 타입(`CameraTrajectoryNode`+`CameraPathNode`, `WorldRefNode`+`WorldAssetNode` 등)은 Phase 1에서 이 표 기준으로 정리한다.

---

## 8. Dependency Tracking

### 8.1 핵심 동작

변경이 발생했을 때 프로젝트 전체를 다시 계산하지 않는다.

```text
Node Change → Mark Dirty → Traverse Dependents
  → Invalidate Affected Cache → Schedule Minimal Rebuild
```

### 8.2 Dirty Event와 전파

```ts
interface DirtyEvent {
  sourceNodeId: string;

  reason:
    | "params_changed"
    | "input_changed"
    | "asset_version_changed"
    | "implementation_changed"
    | "manual_invalidate";

  timestamp: string;
}
```

Node가 변경되면:

1. 변경 Node를 `dirty` 상태로 표시한다.
2. downstream dependency를 탐색한다.
3. 영향을 받는 RenderNode를 찾는다.
4. 영향을 받는 Clip 목록을 계산한다.
5. 해당 Clip의 cache만 무효화한다.
6. 필요한 RenderJob만 생성한다.

예:

```text
Hero Costume 변경
  → CharacterAsset dirty
  → 참조하는 ActorPlacementNode 탐색
  → 영향받는 Clip A, B, F 식별
  → Clip A, B, F만 재렌더링
```

### 8.3 Dependency Service 인터페이스

```ts
interface DependencyService {
  getUpstream(nodeId: string): string[];
  getDownstream(nodeId: string): string[];

  getDirectReferences(nodeId: string): NodeReference[];
  revealReferences(nodeId: string): NodeReferenceLocation[];

  markDirty(event: DirtyEvent): DirtyPropagationResult;
  validateAcyclic(graphId: string): ValidationResult;
}
```

### 8.4 금지사항

- 작은 수정에도 프로젝트 전체 cache 삭제
- UI 컴포넌트가 직접 dependency graph 수정
- Node 삭제 시 참조 Node 자동 삭제
- 파일 이름만으로 cache identity 결정
- Graph 변경과 동시에 동기식 final render 실행

### 8.5 사용자-facing 영향 범위 UX (blueprint 계승)

- shared 노드 수정 시 affected clip list와 다시 렌더될 범위를 **승인 전에** 표시한다.
- 상태 문장 예: "조명 노드를 수정하면 3개 컷이 다시 렌더링됩니다.", "카메라 경로의 78%는 기존 SpatialMemory로 커버됩니다."
- 숨길 것: 내부 캐시 키, dependency hash, scheduler, 모델 내부 구조.

---

## 9. Stage Viewer to Graph Mapping

### 9.1 핵심 원칙

3D Viewport는 단순한 preview 화면이 아니다. 사용자가 Viewport에서 수행한 조작은 Graph 또는 Timeline 데이터로 변환되어야 한다.

```text
Viewport Interaction → Domain Command → Graph Mutation
  → Dirty Propagation → Preview Update
```

### 9.2 직접 상태 수정 금지

```ts
// ❌ BAD
object.position.x = 10;

// ✅ GOOD
commandBus.execute({
  type: "UPDATE_NODE_PARAMS",
  nodeId: placementNodeId,
  patch: {
    transform: { position: [10, 0, 0] },
  },
});
```

### 9.3 Viewport가 생성하는 대표 Node

```text
WorldReferenceNode  PlacementNode  ActorPlacementNode  ConstraintNode
CameraRigNode  CameraPathNode  LensNode  LightingRigNode
ObjectTrajectoryNode  ActionBlockNode  ShotPresetNode
```

Stage Viewer는 `WorldAsset`의 3DGS / mesh / production overlay(actor marks, camera anchors, light sockets, prop sockets)를 표시하고, 배우·소품·조명·카메라 조작을 위 노드들로 기록한다.

### 9.4 Camera Path 데이터

```ts
interface CameraKeyframe {
  frame: number;

  position: [number, number, number];
  rotation: [number, number, number, number];

  focalLengthMm: number;
  focusDistanceM?: number;
  aperture?: number;

  easing?: string;
}

interface CameraPathParams {
  keyframes: CameraKeyframe[];

  lookAtTargetNodeId?: string;
  stabilization?: number;

  interpolation: "linear" | "bezier" | "catmull_rom";
}
```

### 9.5 Camera와 Object Motion 분리

카메라 이동과 피사체 이동을 동일 Node에 저장하지 않는다.

```text
Camera Motion                Object Motion
├── CameraRigNode            ├── ObjectTrajectoryNode
├── CameraPathNode           ├── ActionBlockNode
└── LensNode                 └── ConstraintNode
```

---

## 10. Timeline and Clip Graph

### 10.1 책임 분리

Timeline은 시간 편집을 담당하고, Graph는 컷의 장면 구성과 생성 과정을 담당한다.

### 10.2 TimelineClip 구조

```ts
interface TimelineClip {
  id: string;
  trackId: string;
  name: string;

  startFrame: number;
  durationFrames: number;
  sourceInFrame: number;
  playbackRate: number;

  sourceType: "empty" | "generated" | "video";
  linkedWorldId?: string;

  clipGraphId: string;
  activeVariantId?: string;

  cameraPathNodeId?: string;
  graphSnapshotId?: string;

  cacheStatus: "valid" | "invalid" | "rendering" | "failed";
  proxyCacheId?: string;
  finalCacheId?: string;
}
```

> 레퍼런스의 frame 기반 타이밍 필드 + blueprint의 `sourceType`, `linkedWorldId`, `cacheStatus` 필드를 병합한 구조다. 기존 코드의 `start/end/duration`(초 단위)은 Phase 4에서 frame 기반으로 정리한다.

### 10.3 동기화 원칙

- Timeline Clip은 Graph에 대한 entry point다. Clip이 Graph 자체를 소유하는 것으로 가정하지 않는다.
- Clip 길이와 Camera/Action Node의 시간 범위를 검증한다.
- Graph 실행 결과는 Clip Cache로 연결한다.
- Clip 선택 시 Viewer가 해당 월드와 카메라 상태로 이동한다.
- **Clip Variant는 Graph 전체 복제가 아니라 override layer로 구현한다.**

### 10.4 3패널 동기화

```text
Timeline ↕ Node Graph ↕ World / Stage Viewer
```

사용자가 Clip을 선택하면:

1. Timeline에서 Clip이 선택된다.
2. 해당 Clip Graph가 Graph Panel에 열린다.
3. World Viewer가 해당 컷의 resolved state를 표시한다.
4. Camera가 선택 프레임 위치로 이동한다.

---

## 11. Incremental Rendering and Cache

### 11.1 캐시 계층

```text
L0 — Viewport State Cache
L1 — Node Output Cache
L2 — Clip Proxy Render Cache
L3 — Final Render Cache
```

Lyra 특화 캐시(generated segment, spatial memory, stage render pass, world reconstruction)는 L1(Node Output) 계층의 `CacheKind`로 분류한다.

```ts
type CacheKind =
  | "proxy"               // L2
  | "final"               // L3
  | "node_evaluation"     // L1
  | "generated_segment"   // L1
  | "spatial_memory"      // L1
  | "stage_render_pass"   // L1
  | "world_reconstruction"; // L1

type CacheStatus = "valid" | "invalid" | "rendering" | "failed";
```

### 11.2 Cache Key 입력

```ts
interface CacheKeyInput {
  nodeType: string;
  nodeImplementationVersion: string;

  paramsHash: string;
  inputHashes: string[];
  assetVersionHashes: string[];

  renderBackendVersion?: string;
}
```

포함하면 안 되는 값:

```text
Node UI Position / Panel State / Selection State
Node Display Name / Temporary Timestamp
```

### 11.3 렌더 파이프라인

```text
Graph Evaluation → Resolved Scene State → Proxy Renderer
  → Timeline Preview → User Approval
  → Final Renderer / Video Model → Final Cache
```

### 11.4 Render Job

```ts
type RenderQuality = "viewport" | "proxy" | "final";

interface RenderJob {
  id: string;

  clipId: string;
  renderNodeId: string;

  quality: RenderQuality;
  priority: number;

  cacheKey: string;

  status: "queued" | "running" | "completed" | "failed" | "cancelled";

  createdAt: string;
}
```

렌더 우선순위: 플레이헤드 주변 컷 > visible timeline range > shared 노드 수정으로 invalid된 affected clips > background low-priority queue.

### 11.5 Cache 무효화 표 (변경 대상 기준)

| 변경 대상 | Viewport | Node Output | Proxy | Final |
|-----------|---------:|------------:|------:|------:|
| Node UI 위치 | 유지 | 유지 | 유지 | 유지 |
| Node 표시 이름 | 유지 | 유지 | 유지 | 유지 |
| Camera Transform | 무효화 | 무효화 | 무효화 | 무효화 |
| Lens Parameter | 무효화 | 무효화 | 무효화 | 무효화 |
| Object Transform | 무효화 | 무효화 | 무효화 | 무효화 |
| Material Content | 무효화 | 무효화 | 무효화 | 무효화 |
| Asset Tag | 유지 | 유지 | 유지 | 유지 |
| Asset Content | 무효화 | 무효화 | 무효화 | 무효화 |
| Clip Start 위치 | 유지 | 유지 | 대체로 유지 | 대체로 유지 |
| Clip Duration | 무효화 | 조건부 | 무효화 | 무효화 |
| Render Quality | 유지 | 유지 | 해당 계층 | 해당 계층 |

### 11.6 노드별 무효화 규칙 (Lyra 구체화, node_graph 계승)

| 노드 변경 | invalid 대상 |
|-----------|-------------|
| `WorldAsset` (content) | 해당 월드 참조 컷의 stage + render cache |
| SpatialMemory 갱신 | retrieve result, coverage score 재계산 |
| `CameraPathNode` | generated segment, stage pass, render cache (downstream) |
| `LightingRigNode` | 참조 컷 render cache + affected list 표시 |
| `GenerativeRefinementNode` | refinement/final render만 (구조 cache 유지) |

---

## 12. Model Connector Architecture

### 12.1 기본 원칙

생성 모델은 SceneForge의 Core Domain이 아니라 교체 가능한 backend다. **Lyra 2.0은 첫 번째 Connector 구현체다.**

```text
SceneForge Graph
        ↓
Normalized Request
        ↓
Model Connector
├── Image-to-World      ← Lyra 2.0 (MVP)
├── Novel View
├── Video Generation
├── Camera-Controlled Video
└── Video Editing
```

### 12.2 Condition 정규화

```ts
type ConditionType =
  | "text"
  | "image"
  | "video"
  | "depth"
  | "pose"
  | "mask"
  | "camera"
  | "motion"
  | "world_reference";

interface ModelCondition {
  id: string;
  type: ConditionType;

  assetId?: string;
  payload?: Record<string, unknown>;

  weight?: number;
}
```

### 12.3 Render Request / Connector 인터페이스

```ts
interface RenderRequest {
  requestId: string;

  task:
    | "text_to_video"
    | "image_to_video"
    | "image_to_world"
    | "world_to_video"
    | "video_edit";

  conditions: ModelCondition[];

  frameCount: number;
  fps: number;
  width: number;
  height: number;

  seed?: number;

  backendOptions: Record<string, unknown>;
}

interface ModelConnector {
  id: string;

  supportedTasks(): string[];

  validate(request: RenderRequest): ValidationResult;
  estimate(request: RenderRequest): Promise<ExecutionEstimate>;
  execute(
    request: RenderRequest,
    signal?: AbortSignal
  ): Promise<ModelExecutionResult>;
}
```

### 12.4 Connector 설계 규칙

- 모델별 입력 형식을 Core Graph에 직접 노출하지 않는다. ConditionNode를 모델별 포맷으로 Adapter가 변환한다.
- 모델 결과는 항상 Asset으로 등록하고, 실행 기록(`ModelExecutionRecord`)을 별도 저장한다.
- 모델 이름을 Node Type으로 사용하지 않는다. 모델 전용 옵션은 `backendOptions`에 격리한다.
- Connector 실패가 Project State를 손상시키면 안 된다. 외부 예외는 도메인 에러로 변환한다.
- 모든 비동기 실행은 취소 가능해야 한다 (`AbortSignal`).

### 12.5 Lyra 2.0 Connector (구체화)

- 위치: `infrastructure/connectors/lyra/` (기존 `core/lyra/` — §15 매핑 참조)
- task: `image_to_world` — `ImageToWorldNode`가 발행한 `RenderRequest`를 Lyra job으로 변환
- 입력: 시작 이미지 Asset + `CameraPathNode` trajectory + optional text condition
- 출력 artifact: long-horizon video segment, SpatialMemoryCache, 3DGS, surface mesh → `WorldAsset`으로 패키징, 각 output은 Asset으로 등록
- 실행: 클라우드 GPU job submit/poll (`cloudAdapter`), 로컬 개발용 `stubAdapter`
- MemoryRetrieve / Correspondence는 connector 내부 단계로 처리하고, 사용자에게는 memory coverage %만 노출한다.
- 응답 payload는 Zod 스키마로 런타임 검증한다 (`as` 단독 캐스팅 금지).

---

## 13. Command and Event Architecture

UI, Graph, Timeline, Renderer가 직접 서로의 상태를 수정하지 않게 한다.

```text
UI
 ↓ Command
Application Service
 ↓ Mutation
Domain Store
 ↓ Event
Dependency Engine
 ↓ Event
Render Scheduler / Viewport / Timeline
```

### 13.1 대표 Command

```text
CreateNode  DeleteNode  UpdateNodeParams
ConnectNodes  DisconnectNodes
CreateReference  CreateInstance  CreateCopy
PromoteNodeScope
UpdateClipTiming  CreateVariant  SetActiveVariant
InvalidateCache  RequestRender  CancelRender
```

### 13.2 대표 Event

```text
NodeCreated  NodeDeleted  NodeParamsChanged  NodeReferenceChanged
NodeMarkedDirty  ClipTimingChanged  AssetVersionChanged
CacheInvalidated  RenderQueued  RenderCompleted  RenderFailed
```

Undo/Redo는 Command 단위로 동작한다.

---

## 14. Project File Layout

```text
sceneforge-project/
├── project.json
│
├── assets/
│   ├── source/
│   ├── generated/
│   ├── actors/
│   ├── environments/
│   ├── props/
│   └── materials/
│
├── worlds/
│   ├── manifests/
│   ├── stages/
│   ├── proxy_images/
│   ├── proxy_video/
│   ├── proxy_3d/
│   └── simulation_cache/
│
├── graphs/
│   ├── project/
│   ├── sequences/
│   └── clips/
│
├── timeline/
│   ├── timeline.json
│   └── variants/
│
├── cache/
│   ├── node_outputs/
│   ├── proxy_renders/
│   └── final_renders/
│
├── executions/
│   └── model_runs/
│
└── exports/
```

### 저장 규칙

- 대용량 바이너리를 JSON에 넣지 않는다. JSON에는 ID, URI, hash, metadata만 저장한다.
- 모든 상대 경로는 Project Root 기준이다.
- 임시 결과와 확정 Asset을 분리한다.
- Project 저장에는 atomic write를 사용한다.
- 모든 최상위 문서에 schema version을 포함한다 (`deserializeProject`는 Zod 검증 + 마이그레이션).
- Asset과 Node ID는 파일 경로가 변경되어도 유지한다.

---

## 15. Source Structure

`apps/editor/src/` 아래를 4계층으로 구성한다.

```text
apps/editor/src/
├── domain/
│   ├── assets/
│   ├── worlds/
│   ├── graph/
│   ├── timeline/
│   └── rendering/
│
├── application/
│   ├── commands/
│   ├── queries/
│   └── services/
│
├── infrastructure/
│   ├── persistence/
│   ├── cache/
│   ├── connectors/      ← lyra/ 포함
│   └── renderers/
│
└── presentation/
    ├── timeline/
    ├── graph/
    ├── viewport/        ← stage
    ├── world-generation/
    ├── inspector/
    ├── library/
    ├── chat/
    └── asset-browser/
```

의존성 방향:

```text
presentation → application → domain
infrastructure → domain interface 구현
```

`domain`은 React, Electron, HTTP Client, Database SDK, 3D Rendering Framework, External Model SDK에 직접 의존하면 안 된다.

### 기존 구조 마이그레이션 매핑

| 현재 (`apps/editor/src/`) | 목표 계층 |
|---------------------------|-----------|
| `core/{project,timeline,clipgraph,nodes,references,world}` | `domain/` |
| `core/{dependency,cache}` (순수 로직) | `domain/graph`, `domain/rendering` |
| `core/lyra/` | `infrastructure/connectors/lyra/` |
| `core/render/` (queue, stub) | `infrastructure/renderers/` + `application/services/` |
| `panels/`, `app/`, `components/` | `presentation/` |
| `state/editorStore.tsx` | `application/` (Command/Query) + `presentation/` (view state) |

물리적 이동은 Phase 1에서 한 번에 하지 않고, **의존성 방향 규칙을 먼저 적용**한 뒤 Phase별로 해당 모듈을 이동한다. `.cursor/rules/`의 디렉터리 규칙도 이 표에 맞춰 갱신한다.

---

## 16. MVP Boundary

### 16.1 MVP에서 반드시 구현할 것

1. 준비된 World Asset 로드
2. `WorldReferenceNode` 생성
3. `PlacementNode` 편집
4. `CameraRigNode` 및 `LensNode` 편집
5. `LightingRigNode` 편집
6. 컷별 Clip Graph 생성
7. 여러 컷의 동일 Node 및 Asset 참조
8. Hard Link와 Instance 구분 (`Shared / Instance / Local` 배지)
9. Timeline과 Clip Graph 연결
10. Node 변경 시 dirty propagation
11. 영향받는 Clip만 cache 무효화 (승인 UX 포함)
12. 교체 가능한 RenderConnector (Lyra 2.0 + stub)
13. Proxy Render 결과 Timeline 재생
14. Project 저장 및 재로드

### 16.2 MVP에서 구현하지 않을 것

- 독자적인 Foundation Diffusion Model 학습
- 완전한 Text-to-3D World 생성
- 고급 물리 시뮬레이션
- 실시간 다중 사용자 협업
- 분산 렌더팜
- 완전한 영화 편집 기능 (Import Video Clip 포함 — `VideoSourceNode`는 Future)
- 모든 3D 파일 포맷 지원
- 모든 AI 공급자 지원
- 전체 History의 무제한 보존
- 영화 제작 전 과정의 완전 자동화

---

## 17. UI / Panel Requirements

### Timeline (Composer)

- Premiere Pro 스타일 타임라인, Add Empty Clip, trim / split / reorder / retime
- 각 컷의 linked world, `Shared / Instance / Local` 배지, proxy/final cache 상태, rerender needed 표시
- 플레이헤드 스크럽 시 CameraPath·StageRenderPass·RenderCache 동기화

### World Generation

- 시작 이미지와 optional prompt 입력, 카메라 경로 그리기
- 생성 job 상태 표시 (queued/running/completed/failed)
- GeneratedSegment / SpatialMemory / 3DGS / mesh artifact path 표시
- memory coverage와 새로 생성된 영역 표시

### Stage Viewer (Viewport)

- `WorldAsset`의 3DGS / mesh / production overlay 표시
- actor marks, camera anchors, light sockets, prop sockets 표시
- 배우·소품·조명·카메라 배치 — 조작 결과는 Command를 거쳐 placement / rig / path 노드로 persist
- production overlay toggle

### Graph Editor

- 기본은 현재 컷의 핵심 서브그래프만 표시. 전체 노드 카탈로그는 고급 모드로 숨긴다.
- World Generation / Shot Production / Dependency 뷰 전환
- shared node reveal, affected clips preview

### Inspector

- 선택 노드 파라미터 편집, `Shared / Instance / Local` 배지
- `Reveal References`, `Break Link`, `Make Local`, `Override Value`

### Library (Asset Browser)

- Asset(캐릭터·월드·룩·프리셋)과 project/sequence scope 노드 라이브러리
- 다른 컷으로 shared 또는 instance 참조 연결

### Chat Assistant

- 자연어 의도를 Command로 번역 (노드 생성·연결·참조)
- 예: "이 이미지로 카페 월드를 만들고 오른쪽으로 카메라를 이동해줘" → `ImageSourceNode` + `CameraPathNode` + `ImageToWorldNode`
- 예: "이 조명 세팅을 다음 컷에도 써줘" → `LightingRigNode`를 Shared 참조로 연결
- 챗 입력도 외부 입력이므로 런타임 검증을 거친다.

### 보여줄 것 / 숨길 것

**보여줄 것**: 컷이 공유 중인 월드·캐릭터·룩, 참조 배지, 변경 시 영향받는 컷, memory coverage %, proxy/final cache 상태.

**숨길 것**: DiT 내부 구조, token layout, correspondence injection, 내부 캐시 키, scheduler, low-level dependency hash.

### 17.1 유저 저니

패널 목록이 아니라 샷 작성 순서가 기본 UX다. 상세 플로우는 `docs/user-flows/`를 따른다.

| 저니 | 순서 | 문서 |
|------|------|------|
| 한 샷 작성 | World → Stage → Camera → Performance → Render | `docs/user-flows/shot-authoring.md` |
| 월드·다음 컷 | 생성/연결 → Add Clip(월드 참조 상속) → 컷별 카메라 | `docs/user-flows/world-and-sequence.md` |
| 공유 수정 | Shared 변경 → 영향 컷 승인 → 부분 proxy | 위와 동일 |
| 리뷰·교환 | 재생 → 채널 재렌더 또는 OTIO/XML/EDL | `docs/user-flows/review-and-editorial.md` |

상태 판정은 `domain/workflow/shotWorkflow.ts`가 단일 소스다. Render와 Assistant 렌더 칩은 같은 blocker를 사용한다.

---

## 18. Implementation Roadmap

레퍼런스의 Phase 1–6을 기준 축으로 하고, 기존 계획(P1-A~P2-C)의 작업 항목과 현재 구현 상태를 병합했다.

### 기존 계획 → Phase 매핑

| 기존 (plan) | 통합 Phase |
|-------------|-----------|
| P1-A 참조와 일관성 | Phase 1 (도메인) + Phase 4 (Timeline UI) |
| P1-B Lyra WorldAsset 연결 | Phase 6 (adapter stub은 Phase 5) |
| P2-A 월드 위 촬영 | Phase 3 |
| P2-B 영향 범위 표시 | Phase 2 |
| P2-C 부분 재렌더링 | Phase 5 |
| Future | Future |

> **순서 변경 사유:** 레퍼런스 원칙 "생성 모델 연동보다 월드·그래프·참조·캐시 구조를 먼저 구현한다." Lyra 실연동(P1-B)은 Phase 6으로 이동하고, 그 전까지 샘플 `WorldAsset`(`public/worlds/apartment_livingroom/`)과 stub connector로 개발한다.

### 현재 구현 스냅샷 (`apps/editor`, 2026-08-23 기준)

Phase 1–6 도메인·커맨드·커넥터 골격은 구현됨. vitest 42 passed. `panels/` → `presentation/` 물리 이동과 §14 풀 디렉터리 프로젝트 파일은 후속.

| 모듈 | 상태 | 비고 |
|------|------|------|
| React/Electron 셸 + 전체 패널 (World Generation 포함) | 완료 | `panels/` 하위. `presentation/`은 자리만 |
| `ReferenceType = shared\|instance\|local` + legacy normalizer | 완료 | Hard Link/Instance/Copy와 1:1 (§5.1) |
| `CacheStatus` + `CacheKind` + `CacheKeyInput` | 완료 | L1 Node Output Cache hit 포함 |
| `TimelineClip` frame 타이밍 + `activeVariantId` | 완료 | `startFrame` / `durationFrames`, Variant는 override layer |
| `GraphNode` / `GraphEdge` | 완료 | 포트, EdgeKind, NodeStatus, contentHash, §7.2 kind migrate |
| Asset 계층 (`AssetRecord`) | 완료 | `Project.assets` + registry. world/image 시드 등록 |
| `DependencyService` + `DirtyEvent` | 완료 | `domain/graph/dependencyService.ts` |
| invalidation + job queue | 완료 | §11.5–11.6 표, proxy/final, 취소·재시도 |
| Lyra ModelConnector | 완료 | `infrastructure/connectors/lyra/`. GPU URL 없으면 stub fallback |
| Command/Event 버스, Undo/Redo | 완료 | `application/commands/` |
| Stage 3D 뷰포트 (Three.js) | 완료 | gizmo → Command persist, overlay toggle |
| Zod envelope v2 + atomic localStorage | 완료 | §14 풀 디렉터리 레이아웃은 후속 |
| World Layer/Override (Master→Sequence→Clip) | 완료 | `domain/worlds/layers.ts` |
| Clip Variant (override layer) | 완료 | 그래프 복제 없음 |

---

### Phase 1 — Domain Foundation — 완료

**구현 대상:** `Project`, `AssetRecord`, `WorldAssetManifest`, `GraphNode`, `GraphEdge`, `NodeReference`, `ClipGraph`, `TimelineClip`

**작업**

- [x] Asset 계층 도입: `AssetRecord` + asset registry, 기존 world/segment "노드"를 Asset으로 분리
- [x] `WorldAsset`을 `WorldAssetManifest` 스펙으로 보강 (representation, coordinateSystem, unitScaleMeters, bounds)
- [x] `GraphNode`/`GraphEdge` 스펙 적용: 포트, `EdgeKind`, `NodeStatus`, `contentHash`
- [x] 노드 타입 §7.2 매핑 표대로 정리 (중복 제거: `CameraTrajectoryNode`→`CameraPathNode` 등)
- [x] 순환 참조 저장 전 차단 (`validateAcyclic`)
- [x] envelope v2 + atomic write + schema version + Zod round-trip (§14 풀 디렉터리 레이아웃은 후속)
- [x] Node 삭제 전 참조 검사 (cascade delete 금지)

**완료 조건**

- [x] Project를 저장하고 다시 불러올 수 있다. Node ID와 Asset ID가 유지된다.
- [x] 순환 참조가 차단된다. Hard Link, Instance, Copy가 구분된다.

### Phase 2 — Graph Runtime — 완료

**구현 대상:** Topological Sort, Node Validation, Dirty Propagation, Content Hash, Node Output Cache, Reference Lookup

**작업**

- [x] `DependencyService` 인터페이스(§8.3)로 기존 `core/dependency/` 정형화
- [x] `DirtyEvent` 기반 전파: markDirty → downstream 탐색 → affected clips 계산
- [x] `CacheKeyInput` 기반 content hash (UI 위치·표시 이름 제외)
- [x] Node Output Cache (L1) — 동일 입력 cache hit
- [x] Reveal References / 상태 문장 UX 완성 ("조명 노드를 수정하면 3개 컷이 다시 렌더링됩니다.")
- [x] Inspector: Break Link / Make Local / Override Value
- [x] Command/Event 버스 최소 구현 + Undo/Redo (Command 단위)

**완료 조건**

- [x] 하나의 Node 수정 시 downstream만 dirty가 된다. 연결되지 않은 Clip은 영향을 받지 않는다.
- [x] 동일한 입력은 cache hit가 발생한다. Graph 평가 결과가 결정적이다.

### Phase 3 — World and Stage Viewer — 완료

**구현 대상:** World Load, Object Selection, Transform Editing, Camera Rig, Lens, Lighting, Viewport Command

**작업**

- [x] 샘플 `WorldAsset` 3DGS/mesh preview (Three.js viewport)
- [x] production overlay(`WorldElementRefNode`) 표시 + toggle
- [x] placement·camera·light gizmo 조작 → Command → 노드 persist (직접 상태 수정 금지)
- [x] `CameraPathNode` 키프레임 편집 (§9.4 데이터 구조)
- [x] Camera Motion / Object Motion 노드 분리 (§9.5)
- [x] World Layer/Override: Master → Sequence → Clip → Resolved Shot State

**완료 조건**

- [x] Viewport 조작이 Node Params로 저장된다. 직접 Viewport State만 변경하는 코드가 없다.
- [x] Project 재실행 후 동일한 장면을 복원한다.

### Phase 4 — Timeline Integration — 완료

**구현 대상:** Clip Creation, Clip Graph Binding, Duration Synchronization, Variant Selection, Proxy Playback

**작업**

- [x] `TimelineClip` frame 기반 타이밍 필드 전환 (§10.2)
- [x] Clip Duration ↔ temporal Node(CameraPath, ActionBlock) 시간 범위 검증
- [x] Clip Variant = override layer (`CreateVariant` / `SetActiveVariant`)
- [x] 3패널 동기화: Clip 선택 → Graph 열림 → Viewer resolved state + 카메라 프레임 이동
- [x] Proxy Render 결과 Timeline 재생

**완료 조건**

- [x] Clip 선택 시 Graph와 Viewer가 동기화된다. Clip Duration과 temporal Node가 검증된다.
- [x] Variant 변경 시 Graph 전체를 복제하지 않는다.

### Phase 5 — Rendering — 완료

**구현 대상:** Render Request Normalization, Connector Interface, Job Queue, Proxy Cache, Final Cache, Cancellation, Error Recovery

**작업**

- [x] `RenderRequest` + `ModelCondition` 정규화 (§12.2–12.3)
- [x] `ModelConnector` 인터페이스로 기존 adapter 정규화 (stub connector 포함)
- [x] `RenderJob` 큐: proxy/final 분리, priority(플레이헤드 > visible > affected > background)
- [x] 취소(`AbortSignal`)·재시도·`failed` 상태 + 구조화 로그
- [x] shared 노드 수정 → affected clips 승인 UX → 최소 rerender
- [x] 캐시 무효화 표(§11.5–11.6) 전체 반영

**완료 조건**

- [x] Connector를 변경해도 Graph Schema가 변경되지 않는다.
- [x] 실패한 RenderJob을 재시도하고, 실행 중 RenderJob을 취소할 수 있다.
- [x] 변경되지 않은 Clip은 다시 렌더하지 않는다.

### Phase 6 — Generative World Adapter (Lyra 2.0) — 완료

**구현 대상:** `ImageSourceNode`, Image-to-World Request, `WorldAssetManifest`, Proxy World, Camera-Controllable Preview

**작업**

- [x] Lyra cloud connector (job submit/poll, Zod 응답 검증; GPU URL 없으면 stub fallback)
- [x] 입력 이미지 → Asset 등록, trajectory → `CameraPathNode`
- [x] 생성 결과(video segment, SpatialMemory, 3DGS, mesh) → `WorldAsset` 패키징 + Asset 등록
- [x] `ModelExecutionRecord` 저장 (input asset IDs, conditions, connector ID, model version, seed, params, 실행 시간, output asset IDs, 에러·재시도 기록)
- [x] World Generation Panel: job status, artifact path, memory coverage 표시
- [x] 기존 생성 결과 재사용 — 재호출 없이 Project 복원

**완료 조건**

- [x] 입력 이미지를 Asset으로 등록하고, 생성 결과를 World Asset으로 저장한다.
- [x] 기존 생성 결과를 재사용할 수 있고, 생성 모델을 다시 호출하지 않아도 Project가 복원된다.

### Phase 7 — Shot / Performance Direction Contract — 수직 슬라이스 완료

**핵심 원칙:** 3D 프리비즈는 구도·카메라·렌즈·공간 배치·시선·스크린 방향·동작 경계만 전달한다. 러프 3D 캐릭터 애니메이션은 최종 퍼포먼스 레퍼런스로 사용하지 않는다.

**구현 대상:** `PerformancePlanNode`, Direction Panel, CAM/AUD/PERF timeline tracks, explicit render direction contract

**작업**

- [x] 클립별 `PerformancePlanNode` 생성과 기존 프로젝트 자동 마이그레이션
- [x] 텍스트·라이브 액션·모션 캡처·2D 키 애니메이션 퍼포먼스 소스
- [x] 편집 오디오 URI·오프셋·길이·트랜스크립트와 프레임 단위 dialogue/reaction/action/hold 큐
- [x] Camera Path·Lens·Look-at·라인 오브 액션·보호 카메라 측·스크린 방향을 Shot Direction으로 직렬화
- [x] 3D 캡처의 캐릭터 궤적 제거, Actor Placement는 정적 스테이징 앵커로만 전달
- [x] 바디 메카닉·컨택·표정·의상·프리비즈 보간을 `ignoredCharacterSignals`로 명시
- [x] 범위를 벗어난 퍼포먼스·오디오 큐의 렌더 사전 차단
- [x] Timeline의 CAM/AUD/PERF 분리 표시와 Direction 편집 화면

**완료 조건**

- [x] 정확한 카메라 데이터와 외부 퍼포먼스·오디오 데이터가 서로 다른 입력 스트림으로 전달된다.
- [x] 러프 3D 캐릭터 애니메이션이 최종 영상 렌더 입력에 섞이지 않는다.
- [x] 대사와 리액션 타이밍을 프레임 단위로 검증할 수 있다.

**후속 단계**

- [x] 모델별 camera/structure/body/face/audio capability negotiation과 명시적 downgrade 기록
- [x] 채널별 Lock / Strength / Mask와 채널·프레임 범위 기반 부분 재생성 캐시
- [x] OpenTimelineIO `.otio` 오디오·마커·SceneForge metadata 무손실 왕복
- [x] Premiere XML(FCP 7 `xmeml`) / CMX 3600 EDL adapter — 통합 Import/Export와 기존 Direction Plan 보존
- [x] 배치 좌표 기반 180도 규칙 자동 검증과 위반 프레임 표시
- [x] 모캡·라이브 액션 승인/거절, 컨택·발 미끄러짐·트래킹 신뢰도 품질 게이트
- [x] 다중 캐릭터 actor/target, dialogue/reaction 선행 큐와 overlap 정책

**2026-09-01 후속 수직 슬라이스**

- Connector가 채널별 `unsupported/prompt/reference/exact` 지원 수준과 Lock/Strength/Mask 지원 여부를 선언한다.
- 렌더 계약 v2가 요청 제어와 실제 적용 제어, 거절된 퍼포먼스 소스, 프레임 정확도·편집 오디오 downgrade를 함께 기록한다.
- Performance/Audio 변경은 최종 캐시에 채널별 프레임 구간으로 누적되고 다음 렌더의 `rerenderScope`로 전달된다.
- 두 Actor Placement의 XZ 배치로 라인 오브 액션을 계산하고 모든 Camera Path keyframe의 보호 측을 검사한다. 축 넘기는 차단하지 않고 명시적으로 경고한다.
- 거절된 live-action/mocap 소스는 렌더를 차단하며, 낮은 트래킹·컨택 신뢰도와 높은 발 미끄러짐은 사전 경고한다.
- OpenTimelineIO의 Timeline/Track/Clip/Marker/ExternalReference 구조를 사용하고 `metadata.sceneforge` namespace로 전체 Direction Plan을 보존한다.
- Premiere XML은 sequence marker, 편집 오디오 clip, frame rate를 교환한다. SceneForge가 내보낸 XML은 cue와 plan metadata를 포함해 재가져오기 품질을 높인다.
- CMX 3600 EDL은 record timecode를 action range로 가져오며, SceneForge cue/audio comment가 있으면 actor·source·reaction 관계까지 복원한다.
- 일반 XML/EDL 가져오기는 현재 Performance Source와 Channel Control을 유지하고 타이밍만 교체한다. 전체 무손실 교환의 기준 형식은 계속 OTIO다.

시장·기술 근거와 상세 로드맵은 `docs/research/2026-08-31-shot-performance-control-landscape.md`를 따른다.

### Phase 8 — Guided Shot Workflow — 수직 슬라이스 완료

**핵심 원칙:** 사용자는 노드 그래프 상태를 해석하지 않고도 `World → Stage → Camera → Performance → Render` 순서와 다음 행동을 이해할 수 있어야 한다. 완료 상태는 수동 체크가 아니라 현재 클립 데이터에서 파생한다.

**작업**

- [x] 상단 Shot Workflow와 단계별 Done/Next/Waiting/Optional/Ready 상태
- [x] World, Stage, Camera, Performance, Render의 단일 readiness evaluator
- [x] 단계 클릭 시 실제 작업 화면과 Build/Record 모드로 직접 이동
- [x] 카메라 키가 없는 샷과 유효하지 않은 Direction Plan의 렌더 사전 차단
- [x] 대사 큐가 있는 경우 편집 오디오 가이드 필수화
- [x] 환경 전용 샷과 generic acting을 Optional로 명시하고 불필요한 차단 방지
- [x] 구현되지 않은 상단 Library/Assets 링크를 제거하고 Editor/Worlds/Direction/Render에 실제 동작 연결
- [x] Playback에 첫 blocker와 해결 행동 표시

**완료 조건**

- [x] 초기 샘플 프로젝트에서 Camera가 다음 단계로 표시되고 클릭하면 Viewport Record로 이동한다.
- [x] 필수 blocker가 있으면 Render 버튼이 비활성화되고 이유가 함께 보인다.
- [x] 필수 계약이 충족되면 Render가 다음 단계가 된다.
- [x] 상단 Workflow와 Playback이 동일한 readiness 결과를 사용한다.

상세 플로우와 수용 시나리오는 `docs/user-flows/`를 따른다.

### Future

- `VideoSourceNode` — reference video / plate / motion reference
- camera path estimation, background reconstruction, dynamic scene reconstruction (optional module)
- shot template (interview, dialogue, action, night cafe)
- advanced graph editor mode (전체 노드 카탈로그)
- Novel View / Video Editing connector

---

## 19. 문서 조정 결정

기존 세 문서와 Core Technology Reference 사이의 충돌은 다음과 같이 해소했다.

| # | 충돌 | 결정 |
|---|------|------|
| 1 | 참조 명칭: `Shared/Instance/Local` (기존·코드) vs `Hard Link/Instance/Copy` (레퍼런스) | 저장 모델·UI 배지는 코드의 `shared/instance/local` 유지. Hard Link=shared, Copy=local로 1:1 매핑 (§5.1). 복제 액션 메뉴만 `링크/인스턴스/독립 복사` 3분리 |
| 2 | 노드 네이밍: Lyra 특화 (`CameraTrajectoryNode`, `WorldGenerateNode`) vs 표준 카탈로그 | 표준 카탈로그 채택. §7.2 매핑 표로 이관. 모델 이름 기반 노드 금지 |
| 3 | `WorldAssetNode`·`GeneratedSegmentNode`·`RenderCacheNode`가 "노드" | Asset ≠ Node 원칙 채택. World/Segment는 Asset, Cache는 캐시 엔트리, Clip은 Timeline 객체로 분리 |
| 4 | Lyra 연동 시점: P1-B (이른 단계) vs 레퍼런스 P7 | 레퍼런스 채택 — Phase 6으로 이동. stub connector + 샘플 월드로 선행 개발 |
| 5 | 소스 구조: `core/`+`panels/` vs `domain/application/infrastructure/presentation` | 4계층 채택. §15 마이그레이션 매핑으로 점진 이동. `.cursor/rules/` 갱신 필요 |
| 6 | `TimelineClip` 타이밍: 초 기반 `start/end/duration` vs frame 기반 | frame 기반 채택 (Phase 4), blueprint 고유 필드(`sourceType`, `linkedWorldId`, `cacheStatus`)는 유지 |
| 7 | 상태 enum: cache `valid/invalid/...`만 존재 vs `NodeStatus`, `RenderJob status` 추가 | 셋 다 별도 개념으로 공존: NodeStatus(`clean/dirty/...`), CacheStatus(`valid/invalid/...`), RenderJob(`queued/running/...`) |
| 8 | Memory 노드(`MemoryRetrieveNode`, `CorrespondenceNode`)의 Core Graph 노출 | connector 내부 단계로 이동. 사용자에게는 coverage %만 노출 (모델 내부 비노출 원칙) |
| 9 | Variant: `variant?: string` 필드 vs override layer | override layer 채택. Graph 전체 복제 금지 |

레퍼런스에만 있고 기존 문서에 전혀 없던 항목(신규 도입): Asset 계층(§3), GraphNode 포트/EdgeKind(§4), World Layer/Override(§2.5), DirtyEvent/DependencyService(§8), Command/Event 버스(§13), 캐시 계층 L0–L3와 CacheKeyInput(§11), Project 파일 레이아웃(§14), Acceptance Tests(§21), scope 승격 규칙(§6).

기존 문서에만 있고 레퍼런스에 없던 항목(보존): Lyra 월드 레이어 구성(§2.4), production overlay, memory coverage UX, 노드별 무효화 규칙(§11.6), 패널별 UI 요구사항(§17), Chat Assistant, 상태 문장 UX, 렌더 우선순위, 보여줄 것/숨길 것 정책.

---

## 20. Cursor Coding Rules

### 20.1 Architecture Rules

1. UI Component에서 Domain Store를 직접 수정하지 않는다. 모든 상태 변경은 Command를 거친다.
2. Asset과 Node를 동일한 개념으로 취급하지 않는다.
3. Rendered Video를 Source of Truth로 사용하지 않는다.
4. 파일 경로 대신 ID 참조를 사용한다.
5. Model-specific Schema를 Core Domain에 추가하지 않는다.
6. Dirty Propagation이 없는 Node 구현을 완료로 간주하지 않는다.
7. Cache 무효화 범위가 정의되지 않은 Node Type을 추가하지 않는다.
8. Node Params에는 직렬화 가능한 값만 저장한다.
9. 비동기 작업은 취소 가능해야 한다.
10. Project 재로드 시 복원할 수 없는 상태를 UI에만 저장하지 않는다.
11. 하나의 Clip을 위해 Master World를 복제하지 않는다.
12. 외부 입력(JSON import, connector 응답, IPC, chat 명령)은 Zod로 런타임 검증한다.

### 20.2 새 기능 구현 전 확인사항

```text
1. 이 기능은 Asset, Node, Clip, World 중 어디에 속하는가?
2. Source of Truth는 무엇인가?
3. 어떤 ID로 참조하는가?
4. 어떤 downstream dependency가 영향을 받는가?
5. 어떤 Cache를 무효화해야 하는가?
6. 저장 후 완전히 복원 가능한가?
7. 특정 생성 모델에 종속되는가?
8. Clip, Sequence, Project 중 어떤 Scope인가?
9. Hard Link, Instance, Copy 중 어떤 관계인가?
10. 현재 MVP에 반드시 필요한가?
```

이 질문에 답할 수 없다면 UI부터 구현하지 말고 데이터 모델을 먼저 정의한다.

### 20.3 Anti-Patterns

1. **Prompt Box + Model API + Timeline** — 중간에 World와 Graph가 없으면 SceneForge가 아니다.
2. **Clip별 World 복제** — Object Identity 붕괴, 수정 전파 불가. Shared World Reference + Sequence/Clip Override로 해결.
3. **Model Name 기반 Node** — `GEN3CNode`, `VeoNode` 금지. task 기반 이름 + Connector 설정.
4. **UI State를 Project State로 사용** — React State에만 Camera Pose 저장 금지. Domain/View State 분리, Serialization Test 작성.
5. **모든 수정에 전체 렌더** — Dependency Graph + Content Hash + Dirty Propagation + Layered Cache + Job Queue.
6. **생성 결과만 저장** — Input Asset IDs, Conditions, Connector ID, Model Version, Seed, Parameters, Execution Time, Output Asset IDs, Error/Retry Records를 함께 저장.

---

## 21. Acceptance Tests

### Persistent World

- [x] 동일한 Actor Asset을 여러 Clip에서 참조할 수 있다.
- [x] Actor Asset ID는 Clip이 달라도 동일하다.
- [x] Clip의 local transform override가 다른 Clip에 영향을 주지 않는다.
- [x] Project Scope Material 변경은 모든 Hard Link에 반영된다.
- [x] 저장 후 World Object Identity가 유지된다.

### Graph Dependency

- [x] 순환 Edge 생성이 거부된다.
- [x] Upstream 변경 시 downstream Node만 dirty가 된다.
- [x] 연결되지 않은 Clip Cache는 유지된다.
- [x] Node 삭제 전에 참조 위치를 조회할 수 있다.
- [x] Node의 UI 위치 변경은 Cache를 무효화하지 않는다.

### Stage Viewer

- [x] Camera 이동이 CameraPathNode에 저장된다.
- [x] Object 이동이 PlacementNode에 저장된다.
- [x] Undo와 Redo가 Command 단위로 동작한다.
- [x] 저장 후 동일 프레임의 Camera Pose가 복원된다.
- [x] Camera Motion과 Object Motion이 분리되어 저장된다.

### Timeline

- [x] Clip 선택 시 해당 Graph가 표시된다.
- [x] Clip 선택 시 해당 World State가 표시된다.
- [x] Clip Duration 변경 시 temporal Node가 검증된다.
- [x] Variant 생성 시 전체 Graph를 복제하지 않는다.
- [x] Proxy Render가 Timeline에서 재생된다.

### Rendering

- [x] 동일 Cache Key 요청은 재실행되지 않는다.
- [x] Proxy와 Final Cache가 분리된다.
- [x] RenderJob을 취소할 수 있다.
- [x] Connector 오류가 Graph를 손상시키지 않는다.
- [x] 영향받지 않은 Clip은 재렌더되지 않는다.

---

## 22. Final Principle

> **지속적인 월드 상태를 노드 그래프로 표현하고, 여러 컷이 이를 참조하며, 변경 영향을 추적해 필요한 결과만 다시 생성하는 제작 시스템**

생성 모델은 계속 발전하고 교체된다. SceneForge의 장기적인 기술 자산은 모델 자체가 아니라 다음 구조다.

```text
World
Graph
Reference
Dependency
Asset Identity
Cache
Timeline State
Reproducible Production State
```
