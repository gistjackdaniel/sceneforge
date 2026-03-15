# SceneForge Node Graph Architecture

## 목적
이 문서는 SceneForge의 노드 시스템을 Cursor에서 바로 참조할 수 있도록 마크다운 형태로 정리한 설계 초안이다.
핵심 목표는 다음과 같다.

- 에셋, 월드, 카메라, 배우, 연출 요소를 모두 그래프 기반으로 표현
- Clip / Sequence / Project scope 공유 구조 지원
- Scene Layer와 Cinematic Layer가 실제 UX와 자연스럽게 연결되도록 설계
- 월드 뷰에서의 조작, 녹화, 키프레임 캡처, 카메라 이동이 그래프에 직접 반영되도록 정의
- 촬영 결과가 타임라인 클립과 클립 그래프로 동시에 저장되도록 정의

---

## 1. 핵심 철학

SceneForge의 노드 시스템은 단순 기능 실행 그래프가 아니라, 제작 상태 자체를 표현하는 그래프다.

### 기본 원칙
- **Asset = 원본 데이터**
- **Node = 프로젝트 안에서 데이터를 참조, 배치, 수정, 연출하는 단위**
- **Edge = 참조, 구성, 제약, 속성 연결 관계**
- **Graph = 하나의 클립/시퀀스/프로젝트 상태**
- **Clip = 녹화 또는 수동 편집으로 생성된 시간 구간 + 해당 시점의 그래프 상태**

즉, SceneForge에서 노드는 단순한 계산 노드가 아니라,
**제작 객체 + 제작 관계 + 제작 의도**를 함께 담는 상태 단위다.

---

## 2. 스코프와 참조 타입

### 2.1 Node Scope
- **Clip scope**: 특정 클립에서만 유효한 노드
- **Sequence scope**: 시퀀스 전체에서 공유되는 노드
- **Project scope**: 프로젝트 전체에서 공유되는 노드

### 2.2 Reference Type
- **Hard Link**: 동일 객체 공유, 수정 시 연결된 모든 컷/클립에 반영
- **Instance Reference**: 원본 참조 + 로컬 override 가능
- **Copy**: 연결이 끊긴 독립 복사본

---

## 3. 그래프 기본 모델

## 3.1 노드 종류
SceneForge의 그래프는 크게 다음 네 종류의 노드로 구성된다.

1. **Asset Node**
   - 원본 에셋 또는 재사용 가능한 제작 단위
   - 예: ActorAssetNode, WorldAssetNode, CameraRigAssetNode

2. **Property / Trait Node**
   - 에셋을 구성하는 속성, 스타일, 상태, 표현 요소
   - 예: ExpressionNode, CostumeNode, ColorLookNode, MaterialNode

3. **Placement / Binding Node**
   - 에셋이 월드 안에서 어디에, 어떤 관계로 배치되는지 표현
   - 예: ActorPlacementNode, AttachmentNode, ConstraintNode

4. **Action / Capture Node**
   - 시간 기반 변화, 촬영 기록, 키프레임, 액션 블록
   - 예: CameraPathNode, ActionBlockNode, CaptureClipNode, KeyframeNode

---

## 3.2 에셋과 속성의 관계

SceneForge에서는 **에셋 및 에셋의 특성도 노드로 본다**.
속성 노드는 에셋 노드에 엣지로 연결된다.

예시:

```text
ActorAssetNode(Hero)
 ├─ ExpressionNode(serious)
 ├─ CostumeNode(black_coat)
 ├─ ColorLookNode(cool_tone_skin)
 └─ HairStyleNode(short_wet)
```

이 구조에서 각 속성 노드는 독립적으로 교체 가능하고, 여러 클립에서 재사용될 수 있다.
또한 연결된 그래프 전체를 하나의 상위 노드 또는 프리셋으로 저장할 수 있다.

예:
- `ActorAssetNode(Hero_Base)`
- `ActorConfigNode(Hero_Episode03_Look)`
- `CharacterPackageNode(Hero_NightLook_v2)`

즉,
**여러 개의 속성 그래프를 묶어서 하나의 재사용 가능한 상위 노드로 승격**할 수 있어야 한다.

---

## 4. UX와 노드 시스템 연결

SceneForge의 핵심 UX 영역은 다음과 같다.

- **에셋 뷰**
- **월드 뷰**
- **월드 모드 카메라 뷰**
- **챗봇 패널**
- **클립 그래프 뷰**
- **타임라인**
- **녹화 버튼**
- **키프레임 캡처 버튼**
- **카메라 조작 키보드 키**

이 UX는 모두 동일한 그래프 상태를 서로 다른 방식으로 보여주거나 편집하는 인터페이스여야 한다.

### UX 원칙
- 월드 뷰에서 수행한 조작은 그래프에 반영된다
- 그래프 뷰에서 수정한 연결은 월드 뷰와 카메라 뷰에 반영된다
- 녹화와 키프레임 캡처는 시간축 위의 그래프 상태를 생성한다
- 타임라인 클립은 별도의 비디오 파일이 아니라 **그래프 상태 + 시간 구간 + 캡처 결과**를 포함한다

---

## 5. 전체 계층 구조

```text
Shared Node System
├─ Common Layer
├─ Source Layer
├─ Scene Layer
├─ Cinematic Layer
├─ Look / Render / Post Layer
└─ Capture / Timeline Layer
```

---

## 6. Common Layer

### BaseNode
모든 노드의 공통 부모 타입

**필드 예시**
- `node_id`
- `name`
- `scope`
- `reference_type`
- `enabled`
- `tags`
- `version`
- `created_at`
- `updated_at`

### GroupNode
여러 노드를 묶는 노드

### PackageNode
연결된 하위 그래프 전체를 하나의 재사용 가능한 노드로 저장하는 노드

예:
- 배우 룩 패키지
- 카페 야간 연출 패키지
- 인터뷰 카메라 패키지

### KeyframeNode
시간축 상의 특정 상태를 저장하는 노드

### CaptureClipNode
녹화 결과와 그 시점의 그래프를 함께 저장하는 노드

---

## 7. Source Layer

Source Layer는 원본 입력 또는 외부 참조를 담당한다.

### ImageSourceNode
단일 이미지 또는 이미지 세트

### VideoPlateNode
원본 영상, 배경 plate, reference clip

### HDRINode
환경광 및 배경 환경맵

### USDAssetRefNode
USD 기반 자산 참조

### AudioSourceNode
대사, 효과음, 배경음

### AnimationClipNode
모션 데이터, 애니메이션 소스

### GaussianProxyNode
3D Gaussian 기반 프록시 월드 또는 객체

### FourDGaussianProxyNode
시간 변화가 있는 4D Gaussian 프록시

---

## 8. Scene Layer

Scene Layer는 월드 안에 무엇이 존재하고 어떻게 배치되는지를 표현한다.
이 계층은 특히 **에셋 뷰 ↔ 월드 뷰 ↔ 클립 그래프 뷰** 와 강하게 연결된다.

### 8.1 핵심 개념
Scene Layer의 노드는 월드 안의 구조를 다룬다.
즉,
- 어떤 월드를 쓰는지
- 어떤 배우/프롭이 들어가는지
- 어디에 배치되는지
- 무엇과 연결되는지
- 어떤 물리/제약이 걸리는지
를 표현한다.

### 8.2 노드 목록

#### WorldRefNode
현재 클립/시퀀스/프로젝트가 참조하는 월드 에셋

#### PlacementNode
일반 에셋을 월드 안에 배치하는 노드

#### SpawnNode
월드에 새로운 객체를 추가 생성하는 노드

#### ConstraintNode
객체 간의 관계 제약 정의

#### AttachmentNode
객체를 다른 객체나 캐릭터에 부착

#### PhysicsToggleNode
물리 시뮬레이션 on/off 및 모드 설정

#### SimCacheNode
시뮬레이션 결과 캐시

#### ActorPlacementNode
배우/캐릭터를 월드 안의 특정 위치와 방향으로 배치

#### WorldElementRefNode
월드 내부 요소를 참조하는 포인터 노드

예:
- actor mark
- prop socket
- camera anchor
- material slot
- doorway
- walkable zone

---

## 8.3 월드 에셋의 세부 요소 참조 방식

월드 에셋은 단순 geometry 덩어리가 아니라, 내부적으로 craft 가능한 구조를 가진다.

예:
- 방/구역
- 문/창문/복도
- 가구
- 표면 재질 슬롯
- 배우 마크
- 카메라 앵커
- 라이트 소켓
- 소품 소켓
- semantic zone

이 내부 요소는 `WorldElementRefNode` 로 노출된다.

예시:

```text
WorldAssetNode(CafeWorld)
 ├─ WorldElementRefNode(actor_mark_A)
 ├─ WorldElementRefNode(camera_anchor_wide)
 ├─ WorldElementRefNode(table_socket_center)
 └─ WorldElementRefNode(window_glass_material)
```

그리고 다른 노드들은 이 요소를 참조한다.

```text
ActorPlacementNode(HeroInCafe)
 └─ place_on → WorldElementRefNode(actor_mark_A)

PlacementNode(CupOnTable)
 └─ attach_to → WorldElementRefNode(table_socket_center)

MaterialOverrideNode(WindowTint)
 └─ target → WorldElementRefNode(window_glass_material)
```

즉,
**월드 에셋의 세부 craft 요소는 월드 내부 주소를 가진 참조 노드로 노출되고,
Scene/Cinematic/Post 레이어의 노드들이 이 참조를 통해 연결된다.**

---

## 8.4 Scene Layer와 UX 연동

### 에셋 뷰
- 에셋을 드래그해서 월드에 넣으면 해당 에셋 노드가 자동 생성됨
- 예: 배우 에셋을 월드에 넣으면 `ActorAssetNode` 와 `ActorPlacementNode` 가 생성됨

### 월드 뷰
- 월드 안에서 직접 객체를 배치, 이동, 회전하면 `PlacementNode` 또는 `ActorPlacementNode` 의 transform이 갱신됨
- 월드 내부 소켓, 마크, 카메라 앵커를 클릭하면 `WorldElementRefNode` 와 연결됨

### 클립 그래프 뷰
- 월드에 새 에셋을 추가하면 해당 노드가 자동으로 그래프에 올라감
- 사용자는 그래프에서 세부 속성 노드를 추가 연결 가능

예:
- 배우 객체를 월드에 넣음
- 자동으로 클립 그래프 뷰에 `ActorAssetNode` 가 올라감
- 이후 `ExpressionNode`, `CostumeNode`, `ColorLookNode` 를 연결해 클립 전용 배우 구성을 만든다

---

## 9. Cinematic Layer

Cinematic Layer는 prompting보다 직접 craft를 우선하는 레이어다.
이 계층은 특히 **월드 모드 카메라 뷰, 녹화 버튼, 키프레임 캡처 버튼, 키보드 조작** 과 직접 연결된다.

### 9.1 노드 목록

#### CameraRigNode
카메라 리그 유형 정의
- dolly
- handheld
- crane
- orbit
- shoulder

#### LensNode
렌즈와 광학 파라미터
- focal length
- sensor preset
- anamorphic preset
- DOF params

#### LightingRigNode
조명 리그 정의
- 3-point
- sunset
- neon
- interior practical

#### FramingGuideNode
프레이밍 가이드 정보

#### ShotPresetNode
샷 프리셋
- WS
- MS
- CU
- OTS

#### LookAtNode
카메라나 배우의 시선 타깃

#### ActionBlockNode
배우나 카메라의 고수준 행동 블록

#### CameraPathNode
카메라 이동 경로와 시간 기반 포인트

#### KeyframeCaptureNode
월드 모드 카메라 뷰에서 저장된 카메라 상태/대상 상태의 키프레임

---

## 9.2 Cinematic Layer와 UX 연동

### 월드 모드 카메라 뷰
월드 모드 카메라 뷰는 단순 viewport가 아니라 **Cinematic Layer 편집기** 여야 한다.

여기서 사용자가 하는 행동은 모두 노드에 반영된다.

#### 카메라 이동 키보드 키
예:
- WASD / QE 이동
- 마우스 회전
- shift 가속
- focus key
- orbit target key

이 조작은 현재 활성 카메라 노드 또는 임시 프리뷰 카메라 상태를 변경한다.

#### 키프레임 캡처 버튼
버튼을 누르면 현재 시점의 다음 상태를 저장한다.
- camera transform
- lens params
- focus distance
- look-at target
- framing metadata

즉 `KeyframeCaptureNode` 또는 `KeyframeNode` 가 추가된다.

#### 녹화 버튼
녹화 버튼은 월드 카메라 조작과 월드 상태 변화를 시간축으로 기록한다.
기록 대상 예시:
- 카메라 transform 변화
- lens 변화
- actor movement
- look-at target 변화
- action block trigger

녹화 종료 시 결과는 다음 두 형태로 저장된다.

1. **타임라인 클립 생성**
2. **클립 그래프 생성 또는 갱신**

즉,
**촬영된 클립은 단순 비디오 결과물이 아니라, 해당 시간 구간 동안의 그래프 상태와 연결된 클립 객체** 다.

---

## 9.3 녹화 기반 그래프 생성 흐름

### 시나리오
1. 사용자가 월드 뷰에서 카페 월드를 열음
2. 배우 에셋을 넣음
3. 카메라를 직접 조작함
4. 녹화 버튼을 누르고 촬영함
5. 녹화가 끝나면 타임라인에 클립이 생성됨
6. 동시에 그 클립에 해당하는 그래프가 저장됨

### 결과 구조

```text
TimelineClipNode(CafeTake_001)
 ├─ references → WorldRefNode(CafeWorld)
 ├─ references → ActorAssetNode(Hero)
 ├─ references → CameraRigNode(Handheld)
 ├─ contains → CameraPathNode(Take_001_Path)
 ├─ contains → KeyframeNode(kf_01)
 ├─ contains → KeyframeNode(kf_02)
 └─ contains → ActionBlockNode(Dialogue_Move)
```

즉,
**녹화된 클립 = 월드를 구성하는 그래프 + 그 위에서 기록된 시간 기반 노드들의 묶음** 이다.

---

## 10. Look / Render / Post Layer

이 레이어는 최종 룩과 렌더 결과를 제어한다.

### MaterialOverrideNode
재질 로컬 수정

### RenderSettingsNode
렌더 설정

### ColorGradeNode
색보정 파라미터

### LUTNode
LUT 적용

### StyleNode
전반적 스타일 방향

### CompositingNode
합성

### GrainNode
필름 그레인

### BloomNode
Bloom 효과

### MotionBlurNode
모션 블러

---

## 11. Capture / Timeline Layer

이 레이어는 UX에서의 녹화, 키프레임 캡처, 클립 생성과 직접 연결된다.

### TimelineClipNode
타임라인 위에 올라가는 클립 단위

**포함 정보**
- 시작 시간 / 종료 시간
- 참조 월드
- 참조 에셋
- 클립 그래프 루트
- 프록시 결과 또는 렌더 결과 링크

### RecordingSessionNode
현재 녹화 세션 상태

### KeyframeNode
특정 시점의 상태 저장

### CameraTakeNode
특정 카메라 촬영 테이크

### ClipGraphNode
해당 클립의 루트 그래프 노드

이 구조를 두면,
타임라인과 그래프 뷰가 완전히 분리되지 않고 서로 같은 상태를 다른 방식으로 보여주게 된다.

---

## 12. 그래프 자동 생성 규칙

### 12.1 에셋을 월드에 넣을 때
예: 배우 에셋을 월드에 넣음

자동 생성:
- `ActorAssetNode`
- `ActorPlacementNode`
- 필요 시 `WorldElementRefNode` 연결
- 클립 그래프 뷰에 자동 표시

### 12.2 배우를 구성하는 세부 특성을 붙일 때
예:
- 표정
- 색감
- 의상
- 헤어

자동 또는 수동 연결:
- `ExpressionNode`
- `CostumeNode`
- `ColorLookNode`
- `HairStyleNode`

이 노드들은 배우 에셋 노드에 엣지로 연결된다.

### 12.3 연결된 그래프를 패키지로 저장할 때
예: Hero_NightLook

생성:
- `PackageNode(Hero_NightLook)`

이 노드는 하위 그래프 전체를 하나의 재사용 가능한 노드처럼 다룬다.

### 12.4 녹화할 때
녹화 중 수집:
- camera state samples
- actor transform samples
- active action blocks
- keyframe markers

녹화 종료 시 생성:
- `TimelineClipNode`
- `CameraPathNode`
- `KeyframeNode[]`
- `CaptureClipNode`
- `ClipGraphNode`

---

## 13. 권장 그래프 구조 예시

### 예시 1. 배우 에셋 구성 그래프

```text
ActorAssetNode(Hero)
 ├─ ExpressionNode(tense)
 ├─ CostumeNode(white_shirt)
 ├─ ColorLookNode(warm_skin)
 └─ HairStyleNode(neat)
```

### 예시 2. 월드 안에 배우 배치

```text
WorldRefNode(CafeWorld)
 ├─ WorldElementRefNode(actor_mark_A)
 └─ WorldElementRefNode(table_socket_center)

ActorAssetNode(Hero)
 ├─ ExpressionNode(tense)
 └─ CostumeNode(white_shirt)

ActorPlacementNode(Hero_Blocking)
 ├─ actor → ActorAssetNode(Hero)
 └─ place_on → WorldElementRefNode(actor_mark_A)
```

### 예시 3. 촬영 후 클립 그래프

```text
ClipGraphNode(CafeDialogue_Clip01)
 ├─ WorldRefNode(CafeWorld)
 ├─ ActorAssetNode(Hero)
 ├─ ActorPlacementNode(Hero_Blocking)
 ├─ CameraRigNode(Handheld)
 ├─ LensNode(50mm)
 ├─ CameraPathNode(Take01_Path)
 ├─ KeyframeNode(kf_001)
 ├─ KeyframeNode(kf_002)
 ├─ LightingRigNode(Interior_Practical)
 └─ ColorGradeNode(Dialogue_Warm)
```

그리고 이 `ClipGraphNode` 는 타임라인의 `TimelineClipNode` 와 연결된다.

---

## 14. 구현 원칙

### 14.1 그래프와 월드 뷰의 양방향 동기화
- 월드 뷰 조작 → 그래프 갱신
- 그래프 수정 → 월드 뷰 반영

### 14.2 녹화는 그래프를 시간축으로 샘플링하는 행위
- 녹화는 비디오 캡처 이전에 그래프 상태의 시간 기록이다
- 필요하면 나중에 동일 그래프로 재렌더 가능해야 한다

### 14.3 클립은 결과물이 아니라 그래프 진입점
- 클립을 클릭하면 해당 클립 그래프를 연다
- 클립 그래프는 그 클립을 구성한 월드, 배우, 카메라, 조명, 액션의 루트를 제공한다

### 14.4 에셋 특성도 독립 노드화
- 표정
- 의상
- 메이크업
- 색감
- 스타일
- 머티리얼 성질

이들은 모두 독립 수정 및 재사용 가능해야 한다.

### 14.5 연결 그래프의 패키지화
하위 그래프를 하나의 노드처럼 저장하고 다시 꺼내 쓸 수 있어야 한다.

예:
- 배우 프리셋
- 촬영 패키지
- 세트 드레싱 패키지
- 룩 패키지

---

## 15. 최종 요약

SceneForge의 노드 시스템은 다음 구조를 가진다.

- 에셋도 노드다
- 에셋의 특성도 노드다
- 특성 노드는 에셋 노드에 엣지로 연결된다
- 월드 에셋 내부의 craft 가능한 요소는 `WorldElementRefNode` 로 참조된다
- 월드에 에셋을 넣으면 클립 그래프에 노드가 자동 생성된다
- 녹화 버튼은 그래프 상태를 시간축으로 기록한다
- 키프레임 버튼은 특정 시점의 상태 노드를 생성한다
- 촬영된 결과는 타임라인 클립과 클립 그래프로 동시에 저장된다
- 클립은 곧 그래프 진입점이며, 재편집과 재렌더의 기본 단위다

이 구조를 통해 SceneForge는 단순 생성 툴이 아니라,
**월드 기반 제작 상태를 그래프로 다루는 시네마 제작 IDE** 가 된다.

---

## 16. UX 단순화 전략 (백엔드 복잡도 vs 사용자 인지 부하)

노드 종류가 많을수록 그래프의 표현력은 커지지만, 사용자 입장에서는 선택지가 많아져 학습 부담이 커진다. 챗봇이 있어도 "어떤 노드를 언제 쓰는지"를 사용자가 알아야 하면 UX가 무거워진다. 따라서 **백엔드는 계층·노드 타입을 풍부하게 유지하되, 사용자가 느끼는 인터페이스는 의도·컨텍스트 기반으로 단순화**하는 전략이 필요하다.

### 16.1 원칙: 노드는 구현 디테일, 사용자 언어는 의도

- 사용자가 조작하는 단위는 **노드 이름이 아니라 의도**다.
  - 예: "배우를 카페에 넣어줘" → 내부적으로 `ActorAssetNode` + `ActorPlacementNode` + `WorldElementRefNode` 연결 생성
  - 예: "이 클립에서 표정만 바꿔줘" → `ExpressionNode` 추가/교체
- 챗봇과 모든 주 진입점 UX는 **의도(자연어·버튼·짧은 라벨)** 로 입력받고, 시스템이 적절한 노드/그래프를 생성·수정한다.
- 사용자는 노드 타입 이름을 몰라도 제작이 가능해야 한다.

### 16.2 단일 진입점: 챗봇을 그래프 편집의 주 인터페이스로

- **그래프 뷰를 "노드 종류를 골라서 추가"하는 메뉴뷰로 쓰지 않는다.**
- 기본 플로우는:
  - 월드 뷰 / 타임라인 / 에셋 뷰에서 직접 조작하거나,
  - 챗봇에 "~해줘", "~추가해줘", "~바꿔줘"라고 요청
- 챗봇이 의도를 해석해:
  - 어떤 레이어·어떤 노드(또는 패키지)를 만들지 결정하고,
  - 필요한 엣지까지 연결한 뒤,
  - 결과만 사용자에게 "배우 넣었어요", "표정 바꿔두었어요"처럼 피드백
- 노드가 수십 개여도 사용자는 **자연어 의도**만 기억하면 된다.

### 16.3 컨텍스트별 보기(모드별 서브그래프)

- **전체 노드 목록을 한 화면에 노출하지 않는다.**
- 현재 컨텍스트에 맞는 **모드**만 보여준다:
  - **월드 편집 모드**: 월드, 배치, 스폰, 제약, 월드 내 요소 참조 위주
  - **촬영/카메라 모드**: 카메라 리그, 렌즈, 경로, 키프레임, 액션 블록 위주
  - **룩/연출 모드**: 표정, 의상, 색감, 조명, 포스트 위주
  - **클립/타임라인 모드**: 클립, 테이크, 캡처, 키프레임 타임라인 위주
- 그래프 뷰를 열 때도 **현재 클립/선택된 객체 기준 서브그래프**만 기본 표시 (예: `ClipGraphNode` 단위).
- "전체 그래프" 또는 "모든 노드 타입"은 **고급/전문가 옵션**으로 두어, 필요할 때만 확장.

### 16.4 고수준 블록만 노출 (PackageNode / GroupNode를 1급 시민으로)

- 사용자에게 보이는 단위를 **세부 노드 40개가 아니라, 5~7개 수준의 고수준 블록**으로 줄인다.
  - 예: "캐릭터 룩", "이 클립의 카메라", "이 클립의 배우 구성", "조명 세팅", "이 클립"
- 이미 있는 **PackageNode**, **GroupNode**, **ClipGraphNode**를 UI에서 **기본 단위**로 쓰고,
  - "캐릭터 룩" 열기 → 그때만 내부의 Expression / Costume / ColorLook 등 노드 표시
- 세부 노드 타입은 "블록 열어서 고급 편집" 시에만 등장하게 하면, 일상 사용에서는 종류가 적게 느껴진다.

### 16.5 자동 생성 규칙 강화 (그래프는 주로 "결과물"로 보이게)

- **가능한 한 사용자가 "노드 추가"를 직접 하지 않게** 한다.
  - 에셋을 월드에 넣음 → 노드 자동 생성 (이미 문서화됨)
  - 녹화/키프레임 캡처 → 클립·경로·키프레임 노드 자동 생성
  - "표정 바꿔줘"라고 챗봇에 말함 → `ExpressionNode` 자동 생성/연결
- 그래프 뷰의 역할을 **"무엇이 이 클립/이 객체를 구성하는지 보기 + 필요 시 고급 편집"** 으로 한정하면, "노드 종류 선택"이 주 인터페이스가 되지 않는다.

### 16.6 템플릿/프리셋으로 구조 일괄 생성

- **"인터뷰 촬영", "대화 신", "액션 신", "야간 카페"** 같은 시나리오 템플릿을 제공한다.
- 템플릿 선택 시 해당 시나리오에 맞는 **월드·배우·카메라·조명·클립 구조**를 노드 그래프로 한 번에 생성한다.
- 사용자는 노드 하나하나가 아니라 **시나리오 선택 + 세부 값만 조정**하는 경험을 하게 되고, 노드 종류를 인지할 필요가 줄어든다.

### 16.7 요약 표

| 사용자가 느끼는 UX | 백엔드에서 일어나는 일 |
|--------------------|------------------------|
| "배우 넣어줘" (챗봇/드래그) | ActorAssetNode + ActorPlacementNode + 연결 생성 |
| "표정/의상 바꿔줘" | Property/Trait 노드 추가·교체 |
| 녹화 버튼 한 번 | TimelineClipNode, CameraPathNode, KeyframeNode 등 자동 생성 |
| "이 클립 구성 보여줘" | ClipGraphNode 기준 서브그래프만 표시 |
| "인터뷰 촬영으로 시작" | 템플릿 기반 전체 노드 구조 생성 |
| 고급 편집 / 그래프 전체 | 전문가용으로만 전체 노드 타입·전체 그래프 노출 |

이렇게 하면 **노드 종류는 그대로 두고**, 사용자 경험은 **의도·컨텍스트·고수준 블록·자동 생성**으로 단순화할 수 있다.
