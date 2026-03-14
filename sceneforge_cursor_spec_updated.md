# SceneForge Cursor 작업 문서

## 한 줄 정의
SceneForge는 **프리미어 프로 같은 타임라인 기반 IDE** 위에서, 각 클립이 내부적으로 **재현 가능한 그래프 평가 결과**로 존재하고, **3D simulation world를 배경 asset처럼 유지**하면서 **컷 내부 노드들을 다른 컷에서 참조/인스턴싱/오버라이드**할 수 있는 제작 시스템이다.

---

## 제품 핵심 철학

### 1. Timeline + World + ClipGraph
- 타임라인은 사용자의 메인 작업 공간이다.
- 월드는 장면 일관성의 근원이며, 배경 프로젝트 파일처럼 저장된다.
- 각 타임라인 클립은 단순 mp4가 아니라 내부적으로 ClipGraph를 가진다.
- 컷 자체를 참조하는 것이 아니라, **컷을 구성하는 개별 노드들**이 컷 간 공유된다.

### 2. Prompt-first가 아니라 Craft-first
- 샷 사이즈, 앵글, 조명 같은 연출을 프롬프트로만 해결하지 않는다.
- 먼저 3D world를 구축하고, 그 위에서 카메라/배우/조명을 직접 craft한다.
- 같은 로케이션 안에서 여러 샷을 촬영하듯 작업해야 한다.
- 목표는 single-location consistency다.

### 3. Modularity-first MVP
- 새 프로젝트를 만들 때 전체 시나리오 입력을 강요하지 않는다.
- 새 프로젝트 진입점은 **빈 Composer 타임라인 + 우측 Chat Assistant**다.
- 사용자는 먼저 빈 클립을 추가하거나 실제 영상 클립을 넣고, 필요한 구간에만 World Module 또는 ClipGraph Module을 호출한다.

---

## 최종 UX 컨셉

### 기본 화면 구조
1. **Composer / Timeline Panel**
   - Premiere Pro 스타일 타임라인
   - Video/Audio track
   - 빈 클립 추가
   - 실제 영상 클립 import
   - trim / split / reorder / retime

2. **Chat Assistant Panel**
   - 우측 고정 패널
   - 자연어로 다음 작업 유도
   - 예시
     - 이 구간용 방 배경 만들어줘
     - 이 클립을 참조해서 3D world 맞춰줘
     - 이 컷에 dolly-in 카메라 리그 넣어줘
     - 현재 선택한 노드가 어느 컷에서 쓰이는지 보여줘

3. **World Module / Stage Viewer**
   - 선택된 클립에 대해 world 생성 또는 참조
   - 3D viewport
   - 카메라 gizmo / 조명 gizmo / actor placement

4. **ClipGraph Editor**
   - 선택된 클립의 내부 그래프 편집
   - Graph + Inspector + Library
   - 컷 간 노드 참조 가능

---

## 핵심 데이터 모델

### 1. World Asset
월드는 배경 asset처럼 저장된다.

포함 요소:
- 공간 geometry
- 고정 소품 / 가구 / 조명
- 물리 속성
- semantic label / affordance
- navigation mesh / spawn zones
- 연출 가능한 카메라 마커 / 레일

추천 저장 포맷:
- USD 기반
- optional semantic metadata json
- optional sim cache
- optional gaussian / image-derived proxy representation

예시:
```text
worlds/
  apartment_livingroom/
    world.usda
    semantics.json
    navmesh.bin
    preview.glb
    proxy_3dgs/
    proxy_images/
```

### 2. Timeline Clip
타임라인 클립은 구간 container다.

속성:
- id
- start / end
- duration
- source_type = empty | video | generated
- linked_world_id(optional)
- clipgraph_id(optional)
- world_mode(optional) = image_based | 3dgs | structured_3d | referenced | four_dgs
- proxy_cache(optional)
- final_cache(optional)

### 3. ClipGraph
각 클립 내부의 평가 그래프.

계층:
- Source
- Scene
- Cinematic
- Look/Render/Post

출력:
- preview frames
- final frames
- rendered video cache

### 4. Shared Node System
노드는 컷 간 공유 가능해야 한다.

노드 스코프:
- Clip scope
- Sequence scope
- Project scope

노드 참조 타입:
- **Hard Link**: 동일 객체 공유, 수정 시 연결된 모든 컷 반영
- **Instance Reference**: 원본 참조 + 로컬 override 가능
- **Copy**: 연결 끊긴 독립 복사본

---

## 노드 타입 설계

### A. Source Layer
- ImageSourceNode
- VideoPlateNode
- HDRINode
- USDAssetRefNode
- AudioSourceNode
- AnimationClipNode
- GaussianProxyNode
- FourDGaussianProxyNode(optional)

### B. Scene Layer
- WorldRefNode
- ImageWorldNode
- GaussianWorldNode
- FourDWorldNode(optional)
- PlacementNode
- SpawnNode
- ConstraintNode
- AttachmentNode
- PhysicsToggleNode
- SimCacheNode

### C. Cinematic Layer
Prompting보다 직접 craft를 우선한다.

- CameraRigNode
  - dolly
  - handheld
  - crane
  - orbit
  - shoulder
- LensNode
  - focal length
  - sensor preset
  - anamorphic preset
  - DOF params
- LightingRigNode
  - 3-point
  - sunset
  - neon
  - interior practical
- FramingGuideNode
- ShotPresetNode
  - WS / MS / CU / OTS
- ActorPlacementNode
- LookAtNode
- ActionBlockNode
- CameraPathNode

### D. Look / Render / Post Layer
- MaterialOverrideNode
- RenderSettingsNode
- ColorGradeNode
- LUTNode
- StyleNode
- CompositingNode
- GrainNode
- BloomNode
- MotionBlurNode

---

## 중요한 설계 원칙

### 1. 컷 자체를 공유하지 않는다
공유 대상은 컷 전체가 아니라 컷 내부를 구성하는 노드다.

예시:
- 컷1의 이미지 노드를 컷2가 참조 가능
- 컷1의 lighting rig를 컷2가 참조 가능
- 컷1의 lens package를 컷2가 instance로 가져와 FOV만 변경 가능

예시 개념:
```text
Clip1:
  Use(IMG_042) -> Grade(LUT_A) -> Render

Clip2:
  Use(IMG_042) -> Stylize(Comic) -> Render
```

### 2. Cinematic 계층은 craft 중심
- World를 먼저 고정한다
- 그 위에서 shot을 찍는다
- 카메라와 조명은 reusable rig로 관리한다
- prompt로 CU/로우앵글을 뽑기보다, camera rig template으로 만든다

### 3. World는 scene consistency의 근원
- 같은 방에서 여러 샷을 찍어도 사물이 사라지지 않아야 한다
- world state와 object identity가 유지되어야 한다
- 변경은 dependency graph를 통해 전파된다

### 4. Proxy world와 editable world를 분리한다
- 모든 월드가 처음부터 완전한 structured 3D여야 하는 것은 아니다
- 초기 프리비즈 단계에서는 image-based world 또는 3DGS proxy를 허용한다
- 이후 필요 시 USD 기반 structured 3D world로 승격하거나, 참조 world로 유지한 채 cinematic craft에 활용한다

---

## 모듈형 플로우

### 프로젝트 시작 플로우
1. 사용자가 새 프로젝트 생성
2. 빈 Composer 화면 진입
3. 우측 Chat Assistant 표시
4. 사용자는 아래 중 하나 수행
   - 빈 클립 추가
   - 실제 영상 클립 import

### 빈 클립 플로우
1. 빈 클립 선택
2. Generate World 실행
3. Chat Assistant가 필요한 최소 정보 수집
   - 장소
   - 시간대
   - 분위기
   - 주요 소품
4. 아래 월드 모드 중 하나 선택
   - **Image-based world**
   - **3DGS world**
   - **Structured 3D world**
   - **Reference existing world**
5. World Module이 선택된 방식으로 월드를 생성 또는 연결
6. 사용자가 Stage Viewer에서 배치 조정
7. ClipGraph Editor에서 카메라/조명 craft
8. Proxy render 생성
9. 타임라인 반영

### 실제 영상 클립 플로우
1. 실제 영상 클립 선택
2. Reference World 실행
3. 영상에서 배경/카메라/조명 구조 분석
4. 기본적으로 아래 방식 중 하나를 선택
   - **Reference 3D world from video**
   - **Image/geometry reconstruction**
   - **Optional 4DGS generation**
5. 필요 시 수동 보정
6. ClipGraph Editor에서 extension / relighting / alternate shot 제작
7. Proxy render 생성
8. 타임라인 반영

---

## 빈 클립 vs 실제 영상 클립 차이

### 빈 클립
- 입력: 텍스트, 대화, 짧은 아이디어
- world 생성 자유도 높음
- 카메라와 배우 배치 자유도 높음
- 창작 중심
- 월드 생성 방식 선택 가능
  - image-based world generation
  - 3DGS generation
  - structured 3D world generation
  - 기존 world reference

### 실제 영상 클립
- 입력: video 자체 + optional text
- world는 원본 영상과의 정합성이 중요
- 카메라 경로, 조명, 배경 복원이 중요
- 확장, 재촬영, relighting 중심
- 월드 생성 방식
  - 기본은 video-guided world reference / reconstruction
  - **4DGS generation은 선택사항**
  - 4DGS는 시간에 따라 변하는 장면 동역학, 사람/머리카락/천/움직이는 오브젝트를 유지하고 싶을 때만 사용

### 동일한 점
- 둘 다 ClipGraph를 가짐
- 둘 다 world 참조 가능
- 둘 다 노드 공유 가능
- 둘 다 proxy/final cache 파이프라인을 가짐

---

## 월드 생성 모드 정책

### Empty Clip World Policy
빈 클립은 창작 중심이므로 사용자가 월드 생성 전략을 직접 선택할 수 있어야 한다.

1. **Image-based**
   - 빠른 프리비즈
   - 카메라 이동 폭이 작을 때 적합
   - moodboard / keyframe / concept image 중심

2. **3DGS**
   - 빠른 공간 일관성 확보
   - 실감나는 배경 프록시
   - 큰 카메라 이동은 제한될 수 있으나 single-location previs에는 강함

3. **Structured 3D**
   - USD/PBR/physics 기반
   - 가장 편집 가능성이 높음
   - 배치, 충돌, affordance, camera blocking에 유리

4. **Reference Existing World**
   - 이미 생성된 world asset을 재사용
   - scene consistency 유지에 가장 효율적

### Real Video Clip World Policy
실제 영상 클립은 원본과의 정합성이 우선이다.

1. **Reference / Reconstruction 기본값**
   - 배경, 카메라, 조명 구조를 추출해 참조 world를 만든다
   - relighting, extension, alternate shot의 기반이 된다

2. **4DGS optional**
   - dynamic scene reconstruction이 꼭 필요할 때만 켠다
   - 사람 동작, 움직이는 배경, 시간에 따라 변하는 geometry를 보존할 때 유용
   - 계산 비용과 편집 복잡도가 높으므로 기본값은 아니다

---

## UI 요구사항

### Timeline
- Add Empty Clip
- Import Video Clip
- 선택된 클립의 linked world 상태 표시
- 선택된 클립의 world_mode 표시
- 선택된 클립의 variant 표시
- proxy/final cache 상태 표시

### Graph Editor
- clip 내부 그래프 편집
- drag & drop node creation
- node linking
- hard link / instance / copy 전환

### Library
- project/sequence scope 노드 라이브러리
- 이미지, LUT, camera rig, lighting rig, style preset 저장
- world asset / gaussian proxy / 4DGS asset 저장
- 드래그하여 다른 컷에 참조 가능

### Inspector
- 선택 노드 파라미터 편집
- linked / instanced / local 상태 표시
- break link 버튼
- reveal references 버튼
- current world mode 표시

### Stage Viewer
- 월드 뷰
- actor placement
- camera path editing
- light gizmo
- selected clip state preview
- image-based / 3DGS / structured 3D / 4DGS 오버레이 토글

### Chat Assistant
- 빈 클립일 때
  - 어떤 방식으로 월드를 만들까요? image-based, 3DGS, structured 3D 중 고를 수 있어요
- 실제 영상 클립일 때
  - 원본 정합성 중심으로 참조 월드를 만들까요? 필요하면 4DGS도 선택할 수 있어요

---

## 캐시 및 재렌더 규칙

### 캐시 종류
- proxy cache
- final cache
- per-clip cache
- optional per-node evaluation cache
- optional gaussian/world reconstruction cache

### invalidation 규칙
- 공유 노드 수정 시 해당 노드를 참조하는 모든 컷의 downstream cache invalid
- world geometry 변경 시 관련 클립 전부 재평가
- look node 변경 시 geometry/sim은 유지, render/post만 재실행
- camera node 변경 시 해당 컷의 render cache만 invalid
- 3DGS/4DGS source 갱신 시 world-dependent camera preview cache invalid

### 렌더 우선순위
- 현재 플레이헤드 주변 컷 우선
- visible timeline range 우선
- background low-priority render queue

---

## 추천 기술 방향

### 우선 추천
- **USD 중심 world representation**
- timeline/editor UI는 desktop app
- node evaluation + dependency tracking 직접 구현
- proxy world representation으로 image-based / 3DGS 허용
- real video reconstruction 경로에 optional 4DGS 추가

### 후보 1: USD / Omniverse 중심
장점:
- reference / layer / variant 구조가 강함
- world asset 관리에 적합
- simulation/physics와 잘 맞음
- structured 3D world의 중심으로 적합

### 후보 2: Unreal 중심
장점:
- sequencer 강함
- 실시간 연출 강함
- viewport/tooling 빠름
- 3DGS/4DGS 시각화 프록시를 붙이기 상대적으로 편할 수 있음

### 현재 권장 결론
- 제품의 본질이 **참조/버전/레이어/월드 자산 관리**에 있으므로, core data model은 USD 관점으로 설계
- UI shell은 독립 앱으로 구축
- rendering backend는 교체 가능하게 abstraction
- empty clip에서는 image-based / 3DGS / structured 3D를 모두 허용
- real video clip에서는 reference/reconstruction을 기본으로 하고 4DGS는 optional module로 분리

---

## 현실적인 MVP 단계

### MVP-1
목표: timeline + clipgraph + shared node reference의 최소 동작

포함:
- 빈 Composer 화면
- Empty clip 추가
- clip 선택 시 local ClipGraph 생성
- Source/Look/Render 기본 노드
- 노드 라이브러리
- hard link / instance / copy
- proxy render cache
- 타임라인 playback

제외:
- 자동 world 생성
- 실제 영상 기반 참조 world 복원
- actor blocking 고도화

### MVP-2
목표: world 연결과 craft workflow 추가

포함:
- 수동 world load
- WorldRefNode
- Stage Viewer
- CameraRigNode / LensNode / LightingRigNode
- shot preset templates
- reveal references / break link

### MVP-3
목표: empty clip용 다중 월드 모드 지원

포함:
- 빈 클립용 Generate World
- image-based world generation
- 3DGS generation
- structured 3D world generation
- asset placement
- semantic tagging
- camera space validation

### MVP-4
목표: 실제 영상 클립 참조

포함:
- video import
- Reference World
- camera path estimation
- background reconstruction
- relighting / alternate angle prototype
- optional 4DGS generation

---

## Cursor에게 맡길 구현 우선순위

### 1차 구현 목표
- React/Electron 기반 shell 생성
- 3패널 레이아웃
  - Timeline
  - Graph Editor
  - Inspector/Library
- clip 추가 / 선택 / 삭제
- clip별 graph state 저장
- project-level shared node library 구현
- hard link / instance / copy semantics 구현

### 2차 구현 목표
- Stage Viewer 연결
- WorldRefNode 연결
- world_mode 상태 추가
- proxy render stub 파이프라인
- dependency invalidation 시스템

### 3차 구현 목표
- empty clip용 image-based / 3DGS / structured 3D 선택 UI
- real video clip용 reference / reconstruction / optional 4DGS UI
- camera rig templates
- lighting rig templates
- cache status UI
- reveal references UI

---

## 반드시 지켜야 할 비기능 요구사항
- 사용자는 전체 시나리오를 처음부터 입력하지 않아도 된다
- 시스템 진입점은 script 화면이 아니라 timeline이다
- world 생성은 optional module이어야 한다
- 그래프 편집은 clip-local이 기본이되, cross-clip reference가 쉬워야 한다
- 결과물보다 재현 가능한 recipe가 1급 객체여야 한다
- 모든 변경은 dependency graph를 따라 추적 가능해야 한다
- empty clip과 real video clip은 서로 다른 world generation policy를 가져야 한다
- 4DGS는 강력하지만 고비용이므로 실제 영상 클립에서 optional feature여야 한다

---

## Cursor 작업 시 구현 메모

### 우선 만들 파일/모듈
```text
apps/editor/
  src/
    app/
    panels/timeline/
    panels/graph/
    panels/inspector/
    panels/library/
    panels/chat/
    panels/stage/
    state/
    core/
      project/
      clipgraph/
      nodes/
      references/
      cache/
      world/
      gaussian/
```

### 핵심 타입 예시
```ts
Project
Sequence
TimelineClip
ClipGraph
NodeBase
AssetNode
OpNode
NodeReference
WorldAsset
GaussianWorldProxy
RenderCacheEntry
```

### 구현 순서
1. Project + TimelineClip 모델
2. ClipGraph 모델
3. Shared Node Library
4. Node reference semantics
5. Inspector 편집
6. world_mode 및 world proxy 타입 추가
7. Cache invalidation
8. Stage/world integration

---

## 최종 목표 문장
**SceneForge는 타임라인 위에서 영상을 편집하지만, 실제로는 클립을 편집하는 것이 아니라 world와 graph를 평가해 결과를 얻는 시스템이다.**

즉,
- world는 배경 asset처럼 유지되고
- 클립은 구간 container이며
- 내부 그래프의 노드들은 컷 간 자유롭게 공유되고
- 연출은 프롬프트보다 3D scene craft로 수행되며
- empty clip은 image-based / 3DGS / structured 3D로 유연하게 시작할 수 있고
- real video clip은 원본 정합성을 우선한 reconstruction을 기본으로, 필요 시에만 4DGS를 선택할 수 있다

이 문서를 기준으로 Cursor는 우선 **timeline-first modular editor**를 구현하면 된다.
