# SceneForge 핵심 유저 플로우 — Shot Authoring

기준일: 2026-09-02

관련: [카탈로그](README.md) · [월드·시퀀스](world-and-sequence.md) · [리뷰·편집](review-and-editorial.md)

## 목적

SceneForge의 핵심 사용자는 노드 그래프를 관리하는 사람이 아니라 **한 샷의 의도를 빠르게 고정하고, AI가 바꾸면 안 되는 결정을 보호한 뒤, 필요한 부분만 다시 생성하는 감독·애니메이터·프리비즈 아티스트**다.

따라서 기본 플로우는 기능 메뉴의 나열이 아니라 다음 질문에 순서대로 답해야 한다.

1. 이 샷은 어느 공간에서 일어나는가?
2. 무엇이 어디에 있는가?
3. 카메라는 무엇을 어떻게 보는가?
4. 캐릭터는 어느 소스의 연기와 어떤 타이밍을 따르는가?
5. 렌더 결과에서 어떤 채널만 다시 고칠 것인가?

## 핵심 플로우

```text
World 선택·생성
  → Stage 정적 배치
  → Camera 프레이밍·렌즈·경로 기록
  → Performance 외부 연기·오디오·큐 작성
  → Render capability 협상
  → Review
      ├─ 승인 → 편집 교환(OTIO / Premiere XML / EDL)
      └─ 수정 → 변경 채널·프레임 범위만 재렌더
```

앱 상단의 Shot Workflow는 이 순서를 항상 보여주며, 각 단계는 현재 클립의 실제 데이터에서 완료 여부를 계산한다. 사용자가 체크박스를 수동으로 완료 처리하지 않는다.

## 단계별 정의

### 1. World

사용자는 기존 월드를 선택하거나 레퍼런스 이미지로 새 월드를 생성한다.

완료 조건:

- 선택된 클립의 `linkedWorldId`가 실제 `WorldAsset`을 가리킨다.

막힘:

- 월드가 없거나 삭제된 월드를 참조한다.

화면 이동:

- Workflow의 World를 누르면 `World Gen`으로 이동한다.
- 상단 프롬프트의 `World Setup`도 같은 화면으로 이동한다.
- Viewport에 월드가 없으면 World Gen으로 가는 CTA가 보인다.

분기:

- 샘플 월드를 고른다 / 이미지로 생성한다 / Preview만 본다 / 현재 클립에 연결한다.
- Preview는 이 단계를 완료하지 않는다. `Use in Current Clip`이 완료 조건이다.

### 2. Stage

사용자는 Build 모드에서 캐릭터, 프롭, 조명을 정적으로 배치한다. 이 단계의 목적은 완성된 캐릭터 애니메이션이 아니라 스크린 방향, 시선, 카메라 거리와 180도 축을 제공하는 것이다.

완료 조건:

- `ActorPlacementNode`, `PlacementNode`, `LightingRigNode` 중 하나 이상이 존재한다.

선택적 완료:

- 아무것도 배치하지 않은 경우 환경 전용 샷으로 취급한다.

막힘:

- 퍼포먼스 소스나 큐가 작성됐는데 Actor Placement가 하나도 없다.

화면 이동:

- Workflow의 Stage를 누르면 `Viewport → Build`로 바로 이동한다.

### 3. Camera

사용자는 Stage Motion에서 카메라 궤적을 **Take**로 남긴다.

- **Record** — 한 번 재생하며 매 프레임 포즈를 새 Take N으로 저장한다.
- **Play** — 선택된 Take만 미리보기한다. 키를 찍지 않는다.
- **K** — 현재 프레임에 희소 포즈를 활성 Take에 남긴다 (없으면 Take 1 생성).
- **Generate video** — 선택된 Take의 궤적만 모델에 보낸다.

완료 조건:

- 선택된 Take에 키프레임이 한 개 이상 있다.

권고:

- 여러 Take를 찍고 Generate 전에 쓸 궤적을 고른다.
- 두 배우의 대화 장면은 line of action과 보호할 카메라 측을 지정한다.

막힘:

- 선택된 Take에 카메라 키가 없다.

경고 (렌더는 막지 않음):

- 180도 축을 넘는 키프레임. 의도적 축 넘기는 허용하되 위반 프레임을 표시한다.

화면 이동:

- Workflow의 Camera 또는 Next 버튼을 누르면 Stage Motion으로 이동한다.
- Record / Play / `K` / Take 선택 바가 보인다.

#### 휴대폰으로 카메라 테이크 기록

1. 데스크톱의 `PATH`에 `cloudflared`를 설치하거나 Windows 실행 파일을 프로젝트의 `.local/cloudflared/cloudflared.exe`에 둔다. [Cloudflare 다운로드](https://developers.cloudflare.com/tunnel/downloads/)
2. `apps/editor`에서 `npm run dev`를 실행하고 `http://localhost:4173`에서 에디터를 연다.
3. 샷을 선택하고 **Camera trajectory → Connect phone with QR**을 누른다. 페어링할 때만 촬영 페이지와 해당 테이크 전송을 위한 임시 Cloudflare HTTPS 주소가 열린다.
4. 휴대폰 기본 카메라로 QR을 스캔한다. Android는 Chrome에서 **Start AR**을 누른다. iPhone은 Safari에서 QR 링크를 열고 아래의 기준 마커로 촬영한다. 처음에는 카메라 권한을 허용한다. [Android WebXR 요구사항](https://developers.google.com/ar/develop/webxr/requirements)
5. 녹화가 시작될 때까지 시작 위치와 방향을 유지한다. **Stop and send**를 누르거나 샷 길이에 도달하면 테이크가 데스크톱으로 전송된다. 테이크가 도착할 때까지 데스크톱의 페어링 패널을 열어 둔다.
6. 데스크톱에서 새 **Phone camera** 테이크를 재생한다. 첫 6DoF 포즈의 위치와 수평 방향이 기존 샷 카메라의 첫 프레임에 맞춰지고, 이후 이동은 미터 단위로 기록된다.

USB로 연결하려면 Chrome DevTools에서 휴대폰 포트 `4173`을 데스크톱 에디터 포트로 포워딩한다. **Connect phone via USB**를 누르고 안내된 **Phone link**를 Android Chrome에서 연다. [Chrome USB 포트 포워딩](https://developers.google.com/ar/develop/webxr/requirements)

##### iPhone Safari로 촬영

1. 데스크톱 QR 아래에 있는 **Show tracking marker**를 누른다.
2. 화면에 표시된 검은 정사각형 바깥 변의 길이를 잰다. Safari에서 **Marker width (cm)**에 길이를 입력한다.
3. **Start camera**를 누르고 카메라 권한을 허용한다. 마커의 네 모서리가 화면 안에 들어오면 녹화가 시작된다.
4. 마커를 표시한 화면을 수직으로 고정하고 네 모서리가 계속 보이도록 iPhone을 움직인다. 마커가 화면 밖으로 나가면 마지막 정상 포즈가 유지된다.

Safari는 마커의 실제 크기와 추정 렌즈값으로 카메라 위치와 회전을 계산한다. 테이크에는 카메라 경로가 저장된다.

##### iPhone 앱으로 촬영

1. Mac에서 [SceneForgeCamera.xcodeproj](../../apps/ios/SceneForgeCamera.xcodeproj)를 Xcode로 연다. ARKit 월드 추적을 지원하는 iOS 16 이상 iPhone을 연결한다.
2. **Signing & Capabilities**에서 팀을 선택한다. iPhone을 실행 대상으로 선택하고 **Run**을 눌러 SceneForge Camera를 설치한다. 필요하면 iPhone에서 개발자 모드를 켠다. [Apple 기기에서 앱 실행](https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device)
3. 데스크톱 에디터에서 새 QR을 만들고 iPhone으로 스캔한다. Safari에서 **Use installed iPhone app**을 펼치고 **Open SceneForge Camera**를 누른다. 촬영 중에는 세로 화면을 기준으로 위치, 회전, 렌즈 투영값, 추적 상태를 기록한다. [Apple ARCamera](https://developer.apple.com/documentation/arkit/arcamera)

QR 페이지의 버튼으로 앱이 열리지 않으면 **Copy pairing link**를 누른다. iPhone 홈 화면에서 SceneForge Camera를 열고 **Paste**를 누른다. 홈 화면에서 앱을 열 수 없다면 Mac의 Xcode에서 iPhone을 실행 대상으로 선택해 앱을 설치하고 실행한다.

추적이 끊기면 마지막 정상 포즈를 유지한다. WebXR과 ARKit은 복구 직후 위치 점프를 추정 보정과 함께 저장한다. WebXR 추적 원점이 재설정되면 그 시점까지의 테이크를 전송한다.

**Scene output → Export render passes**에서 선택된 테이크의 TAR를 받는다. `scene.json`은 샷 상태를, `camera.json`은 카메라 경로와 추적 이벤트를 담는다. `manifest.json`에서 해상도, 패스 순서, 인스턴스 ID 표를 확인한다. 바이너리 패스는 little-endian이며 프레임, 행, 열, 채널 순서로 저장된다. 표면 추적 패스에는 픽셀마다 프록시 파트 번호와 파트 로컬 좌표가 있다. 내보내기는 레퍼런스 프록시 지오메트리를 렌더링한다.

### 4. Performance

사용자는 캐릭터 연기를 3D 블로킹과 분리해 작성한다. 텍스트, 라이브 액션, 모션 캡처, 2D 키 애니메이션이 외부 퍼포먼스 소스가 되고, 오디오 및 dialogue/reaction/action/hold 큐가 타이밍을 제공한다.

완료 조건:

- 작성된 소스·큐·오디오가 모두 유효하고 클립 범위 안에 있다.

선택적 완료:

- 환경 전용 샷 또는 일반적인 연기를 AI에 맡기는 샷은 비워둘 수 있다.
- Actor Placement가 있는데 비어 있으면 “generic acting” 경고를 보여주되 렌더를 막지 않는다.

막힘:

- 큐가 클립 범위를 벗어난다.
- 큐가 존재하지 않는 배우·소스·선행 큐를 참조한다.
- 거절된 퍼포먼스 소스가 활성화되어 있다.
- 대사 큐가 있는데 편집된 오디오 가이드가 없다.
- 퍼포먼스가 작성됐지만 3D에 배우가 배치되지 않았다.

화면 이동:

- Workflow의 Performance를 누르면 `Direction`으로 이동한다.

### 5. Render / Review

SceneForge는 Shot Direction과 Performance Direction을 모델 capability에 맞춰 협상하고, 지원하지 않는 Lock·Strength·Mask 또는 소스를 명시적으로 downgrade한다.

렌더 가능 조건:

- World, Stage의 필수 조건, Camera, Performance 검증에 blocker가 없다.

Review 결과:

- Playback에서 영상을 확인한다.
- 승인하면 OTIO, Premiere XML 또는 EDL로 편집 타이밍을 넘긴다. Playback Export OTIO가 바로 가는 경로다.
- 수정하면 변경된 direction channel과 clip-local frame range만 캐시에서 무효화하고 부분 재렌더한다.
- 렌더 실패 시 그래프는 유지되고, 같은 Render 버튼으로 재시도한다.

## 처음 진입하는 사용자의 기대 경로

초기 샘플 프로젝트는 월드가 이미 연결돼 있으므로 다음 행동은 Camera다. 상단 Workflow는 `Camera · No camera recorded · Next`를 표시하고, 우측 Next 버튼은 `Record camera`가 된다. 이를 누르면 Viewport의 Record 모드가 열리고 카메라 키 추가가 즉시 가능해진다.

이 상태에서는 Playback의 Render 버튼을 비활성화하고 다음 blocker를 문장으로 보여준다. 설정되지 않은 샷에 `Contract valid`와 활성 Render 버튼을 보여주지 않는다.

단축:

- 상단 `Editor`는 Viewport Build, `Worlds`는 World Gen, `Direction`은 연기 패널, `Render`는 Playback Render로 스크롤한다.
- Assistant의 CU 샷 / 월드 연결 / 렌더 칩은 같은 계약을 따른다. 렌더 칩은 blocker가 있으면 비활성이다.

## 같은 공간의 다음 샷

1. Timeline에서 Add Clip을 누른다.
2. 새 클립은 선택 중이던 컷의 월드를 참조한다. World를 복제하지 않는다.
3. Workflow는 Camera를 Next로 보여 준다. Stage·Performance는 다시 Optional이다.
4. 이 컷의 카메라와 연기를 기록한 뒤 렌더한다.

월드가 없는 컷에서 Add Clip하면 새 컷도 World가 Next다.

## 재수정 플로우

1. 사용자가 이미 렌더된 클립을 선택한다.
2. Workflow의 각 단계는 현재 캐시가 아니라 원본 direction data를 기준으로 완료 상태를 보여준다.
3. Performance cue 12–24f만 수정하면 body/face의 해당 범위만 무효화된다.
4. Render 단계는 `N channel(s) need re-render`를 보여준다.
5. 재렌더 후 결과를 검토하고 편집 포맷으로 내보낸다.

## 내비게이션 원칙

- 상단 `Editor`, `Worlds`, `Direction`, `Render`는 모두 실제 동작해야 한다. 구현되지 않은 Library/Assets 버튼은 노출하지 않는다.
- 단계 버튼은 기능 설명이 아니라 해당 작업이 가능한 정확한 모드로 이동한다.
- 완료 상태는 프로젝트 데이터에서 파생하며 로컬 UI 체크 상태로 저장하지 않는다.
- Optional은 숨기지 않는다. 환경 샷 또는 AI 일반 연기처럼 의도적으로 생략 가능한 결정임을 표시한다.
- Render 버튼을 막을 때는 반드시 첫 blocker와 해결 경로를 함께 보여준다.

## 수용 시나리오

1. 월드가 없는 클립은 World가 Next이고 Render가 비활성화된다.
2. 월드는 있지만 카메라 키가 없는 환경 샷은 Camera가 Next이며 Stage와 Performance는 Optional이다.
3. 카메라 키가 하나 있는 환경 샷은 Render가 Next다.
4. 퍼포먼스 큐가 있지만 배우 배치가 없으면 Stage가 Next다.
5. 대사 큐가 있지만 오디오 가이드가 없으면 Performance가 Next다.
6. 모든 필수 계약이 유효하면 `Shot contract ready`와 활성 Render 버튼이 표시된다.
7. 이미 final cache가 유효하면 Render 단계는 완료 상태와 Review 행동을 보여준다.
8. Add Clip 후 상속된 월드가 있으면 Camera가 Next다.
9. 180도 경고만 있는 샷은 렌더를 막지 않는다.
10. Assistant 렌더 칩은 Playback과 같은 blocker로 비활성화된다.

이 플로우의 상태 판정은 `domain/workflow/shotWorkflow.ts`가 단일 소스이며, 상단 Workflow와 Playback Render gate가 같은 결과를 사용한다.

