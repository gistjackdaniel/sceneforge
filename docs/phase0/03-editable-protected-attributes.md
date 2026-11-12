# Phase 0 편집 속성, 보호 속성, 프리뷰와 최종 렌더

- 상태: 연구 레인 초안. 제약 수준은 대상 샷의 제안이고, 팀이 확인한다.
- 대상 샷: [데모 스크립트](01-demo-scripts.md)
- 채점: [평가 프로토콜](02-evaluation-protocol.md)의 G3가 이 문서의 hard 허용오차를 읽는다

3D가 Source of Truth다. 비디오 모델은 그 상태 위에서 허용된 속성만 그리는 선택적 렌더러다. 잠긴 영역의 보증은 프레임 전체가 픽셀 단위로 같다는 뜻이 아니다. 보호 영역이 결정적 패스와 같다는 뜻이다.

## 1. 제약 수준

로드맵의 세 단계와 같은 이름이다.

| 수준 | 누가 픽셀을 내는가 | 합격 |
| --- | --- | --- |
| hard | 결정적 렌더와 합성. 생성 샘플이 이 픽셀을 덮지 않는다. | 아래 hard 허용오차. 시드가 달라도 이 영역은 같다. |
| geometry | 구조화 조건과 검증. 생성기는 텍스처와 잔주름을 더할 수 있고, 기하·포즈·접촉·신원 키는 입력을 따른다. | 포즈, 접촉, 카메라, 신원 지표. 픽셀 일치는 요구하지 않는다. |
| generative | 제한된 생성. 신원과 잠긴 기하를 깨지 않는 범위의 디테일. | 정성 루브릭의 시간 안정. 편집 샷에서는 locality. |

한 속성이 샷 안에서 수준을 바꿀 수 있다. 컵의 변환은 내려놓는 동안 geometry이고, 테이블에 안착한 뒤 스크립트 E에서는 hard에 가깝게 고정된다. 표의 "대상 샷 기본값"은 편집 전 성공 테이크 기준이다. 편집 명령의 `preserve`가 더 세게 잠그면 그 명령이 이긴다.

### hard 허용오차 (제안)

G3가 읽는다. 최악 시드 기준이다.

- 보호 마스크 안에서, 합성 결과와 결정적 패스의 8비트 RGB 차가 픽셀당 최대 1이다.
- 같은 마스크의 LPIPS는 0.01 이하다. LPIPS만 통과하고 RGB 차가 1을 넘으면 실패다.
- 3D를 같이 볼 수 있으면, 보호 표면의 점-메시 거리는 1 mm 이하다.
- 허용오차 밖의 픽셀이 하나라도 있으면 그 샷은 hard 실패다. 평균으로 상쇄하지 않는다.

합성 경계(머리카락, 알파, 반사, 그림자)는 이 허용오차를 느슨하게 만드는 이유가 아니다. 경계를 보호 마스크에 넣었으면 같은 규칙이다. 경계를 생성에 맡기려면 그 속성의 수준을 generative로 명시하고 마스크에서 뺀다.

## 2. 속성 표

대상 샷에서 제안하는 기본 수준이다. "현재 필드"는 저장 스키마에 있는 이름이고, "없는 것"은 이 레인이 문서로만 요구하는 칸이다.

| 속성 | 기본 수준 | 대상 샷에서 잠그는 범위 | 현재 필드 | 비어 있는 칸 |
| --- | --- | --- | --- | --- |
| geometry | 방은 hard, 몸 실루엣은 geometry | `setAssetRef`와 테이블 메시는 hard. 배우 메시의 토폴로지는 리비전에 고정되고, 실루엣은 포즈를 따른다. | `AssetRevision.uri`, `contentHash`, `setAssetRef`, `assets[].kind = "set" \| "character" \| "prop"` | 샷 `Subject`에는 토폴로지 해시가 없다. 리비전 `contentHash`를 쓴다. |
| rig / facial controls | 몸은 geometry, 얼굴은 구간별 | 몸과 손은 입력 SMPL-X. A의 얼굴은 대사 구간 `[8, 40)`만 geometry. 그 밖과 B의 얼굴은 hard (입력 `jaw_pose`, `expression` 고정). | `skeleton.model = "smplx"`, `betas` 길이 10, `rig.partMap`, `SMPLX_PART_JOINT`, Backbone `jaw_pose`, `expression`, `left_hand_pose`, `right_hand_pose`. 채널 `performance_body`, `performance_face` | 페이셜 리그는 SMPL-X 표정 10과 턱 3이다. FACS 슬라이더는 없다. |
| hair / groom | generative | 신원 실루엣을 바꾸는 기장·형태 변경은 이 샷의 편집 명령에 없다. 가닥 디테일은 생성에 맡긴다. | 없음. `assetKindSchema`에 groom이 없다. | 그룸 AOV와 가닥 곡선이 없다. hard로 올리려면 결정적 헤어 패스를 마스크에 넣고 수준을 바꿔야 한다. |
| material | 방·테이블·컵은 hard, 옷의 미세 텍스처는 generative | 컵과 세트의 재질 id는 유지. 옷 주름의 고주파만 생성. | 리비전 `uri`. B2의 material AOV는 렌더 수출이지 샷 필드가 아니다. | `Shot`과 `SceneState`에 재질 슬롯이 없다. `WorldElement.kind`에 `material_slot`만 있다. |
| pose | geometry | A, B의 관절 궤적. 스크립트 E에서 A는 편집 전과 동일한 배열로 hard에 가깝게 고정된다 (`actor_motion`). | `PerformancePlanParams`, Backbone 사람 프레임, 샷 `Motion` (`explicit` 키, `provenance.kind: "keyed"`) | 음성 모션 타입 `generated`는 열거형에 없다. 샷 키는 희소 요약이라 포즈 정답이 아니다. |
| contact | geometry | `handshake_01`, `cup_hold_01`, `cup_place_01`. 스크립트 E는 컵 접촉 둘을 `preserve`로 고정. | 컵: `attachments[]`의 `parentInstanceId`, `rigPart`, `offset`, `frameRange`, `sourceContactId`. 보존 셀렉터 `contact` | 악수 레코드와 `rigPart`는 씬 스키마에 없다. `PerformanceCue`에도 `rigPart`가 없다. `directionContract.shot.ignoredCharacterSignals`에 `contact`가 있어, 접촉은 샷 연출 쪽이 아니라 퍼포먼스·접촉 그래프 쪽이다. |
| object transform | 컵은 geometry, 테이블은 hard | 컵은 매 프레임 `T_world_obj`와 부착이 같이 있다. 테이블은 `motionMode: "static"`, `restTransform` 고정. | `motionMode`, `restTransform` (`translation`, `rotation`, `scale`), `backboneObjectPoseSchema.frames[].T_world_obj`. 샷 `placement`는 `position`, `rotationEuler`, `scale` | `motionMode: "dynamic"`은 플래그다. 월드 레인은 솔버를 돌리지 않는다. 샷 `Motion`은 매 프레임 행렬을 저장하지 않는다. |
| camera | hard | 테이크 전체. 스크립트 E에서 키와 `c2w`가 편집 전과 같다. | `Shot.camera`, `CameraTake.source`, `CameraKey`, `directionContract.shot`, `channelControls.camera.locked` 기본 `true`, Backbone `c2w` | 샷 회전 필드는 `rotation`, 연출 계약은 `rotationQuaternion`. 그래프 보간의 `bezier`는 샷에 없다. |
| lighting | 실용 조명은 hard, 분위기 잔광은 generative | 샷에 `kind: "light"` 주체가 있으면 `intensity`와 `color`는 hard. 없으면 세트 리비전에 구운 조명을 hard로 보고, 생성 모델의 노출 드리프트만 정성으로 본다. | `LightSubject.intensity`, `color`. 씬 오브젝트 `role: "light"`에는 세기 필드가 없다. | 대상 샷의 필수 출연은 배우 둘, 컵, 방, 카메라다. 조명은 방 리비전에 포함된다. 샷 라이트와 씬 라이트의 필드가 같지 않다. |
| identity | hard | `actor-a`, `actor-b`, `object-cup`의 id, `assetRef`, 배우 `betas`. `instance_identity`는 보존 검사가 항상 포함한다. | 씬 인스턴스 id, `assetRef`, `betas`. 샷 `assetId`, `assetVersion`, `Subject.id` | 샷 id와 씬 id를 묶는 외래 키는 없다. 데모 수출은 같은 문자열을 쓴다. `generateHash`는 표시 이름을 제외한다. 이름을 바꿔도 신원 해시는 유지되는 쪽이 맞다. |

`Subject.locked`는 주체 전체를 건드리지 못하게 하는 불리언이다. hard / geometry / generative의 대체가 아니다. `channelControls.locked`는 채널 단위다. 카메라와 구조의 기본값은 잠금, 몸과 얼굴의 기본값은 열림이다. 대상 샷은 그 기본값 위에서 B의 `performance_face`만 추가로 잠근다. A의 얼굴은 대사 구간에 한해 열린다.

## 3. 누가 무엇을 고쳐도 되는가

편집 가능한 것:

- B의 악수 손 (`handshake_01.targetRigPart`, B의 손 포즈와 그 팔의 IK).
- 음성에서 다시 뽑는 B의 `actor_motion`. 소스 타입은 수출에서 `generated`.
- generative로 남긴 그룸 디테일과 옷의 고주파.
- 샷 길이와 fps. 바꾸면 다른 샷이다. 8.0초, fps 16은 이 데모의 시계다.

보호되는 것:

- A의 포즈 전체 (`actor_motion`). 루트만 지키는 것으로 바꾸려면 `actor_root_motion`을 명시해야 하고, 그러면 이 문서의 기본 제안과 다른 실험이다.
- 카메라 테이크와 연출 계약의 연속성 (`cameraSide`, `screenDirection`, `lineOfActionLabel`).
- 방과 테이블 (`set_layout`, `setAssetRef`, 테이블 `motionMode: "static"`).
- 컵의 부착과 `T_world_obj` (손 편집 중).
- 인스턴스 신원.
- B의 `jaw_pose`와 `expression`. 손 편집이 얼굴을 열지 않는다.

`preserve`에 없는 속성은 생성기가 건드릴 수 있다. 그 경우에도 identity와 hard 마스크는 내려가지 않는다. identity는 셀렉터에 없어도 검사가 보존으로 본다.

## 4. 프리뷰와 최종 렌더

둘은 같은 샷 기록을 읽고, 쓰는 픽셀의 책임이 다르다. 프리뷰 픽셀을 승인본으로 저장하지 않는다.

| | 프리뷰 | 최종 렌더 |
| --- | --- | --- |
| 목적 | 포즈, 접촉, 카메라, 신원을 보고 3D 편집을 수락하거나 되돌린다. | 평가 게이트와 승인 픽셀. |
| 모델 | 같은 Wan 2.2 계열의 소수 스텝 증류. 제안은 4–8스텝. | `Wan2.2-Fun-5B-Control-Camera`에서 시작한 전체 샘플링. 채택된 조건(A', B2, C, D 중 게이트가 고른 것)을 붙인다. |
| 조건 | 가능하면 최종과 같은 조건 채널. 증류가 채널을 빠뜨리면 빠진 채널 이름을 프리뷰 로그에 적는다. | 게이트가 고른 조건 전체. G-buffer는 메시에서 렌더한 값이다. |
| 3D 상태 | 읽기만 한다. 프리뷰가 `Shot`, `SceneState`, 포즈, 테이크를 덮어쓰지 않는다. | 같다. 최종 영상은 `Shot.renders`에 영수증으로 붙고, 주체와 카메라를 교체하지 않는다. |
| hard 영역 | 뷰포트의 결정적 프리뷰가 보여 주는 기하가 권위다. 증류 픽셀이 hard 영역을 지켜다고 승인하지 않는다. | 합성 결과가 §1의 hard 허용오차를 지킨다. |
| geometry 영역 | 관절, 부착, 카메라 키를 스크럽할 수 있으면 충분하다. 재질 일치는 요구하지 않는다. | pose, contact, camera, identity 지표의 채점 대상이다. |
| 지연 | 인터랙티브. 수치 예산은 팀이 정한다. 이 문서가 정한 요구는 전체 샘플링을 기다리지 않고 포즈와 접촉을 확인할 것, 한 가지다. | 프로토콜의 latency와 GPU-sec. |
| 영수증 | `ShotRender`에 넣지 않는다. 승인 해시의 입력이 아니다. | `ShotRender`에 남긴다. `status: "succeeded"`는 `artifactUri`가 있을 때만이다. `stubbed`는 승인본이 아니다. |

프리뷰에서 손이 통과하면 그 상태에서 최종 렌더를 돌리지 않는다. 입력 층 contact 실패는 [평가 프로토콜](02-evaluation-protocol.md)대로 렌더 전 탈락이다. 최종이 고쳐 주기를 기대하지 않는다.

증류 모델이 최종과 다른 신원을 보이면 프리뷰는 그 샷의 승인 도구로 쓰지 않는다. 뷰포트 메시와 `assetRef`가 신원 확인의 폴백이다.

## 5. 출처 해시

재현은 프레임 전체가 시드만으로 같다는 약속이 아니다. 보호 영역이 결정적 패스와 같고, 생성 영역은 모델·시드·패스·마스크를 되풀이하면 같은 절차로 다시 뽑힌다는 약속이다.

이미 있는 `generateHash`는 FNV다. 입력은 `Shot.time`, `environment.worldId`, 주체의 `assetId`, `assetVersion`, `uri`, `kind`, `placement`, `motion`, 라이트의 세기와 색, 카메라 보간, 렌즈, `takeId`, 키. 표시 이름, 테이크 이름, 렌더 영수증은 빠진다. 시드, 패스, 마스크, 가중치 해시는 빠진다.

최종 provenance는 `generateHash`를 한 필드로 포함하고, 나머지를 더한다. 저장 스키마에는 아직 이 객체가 없다. 평가 로그와 최종 영수증의 확장으로 남긴다.

```json
{
  "shotGenerateHash": "<Shot.generateHash>",
  "model": {
    "id": "Wan2.2-Fun-5B-Control-Camera",
    "weightsHash": "<sha256 of weights>",
    "adapterHash": "<sha256 or null>"
  },
  "seed": 0,
  "sampler": { "steps": 0, "schedule": "" },
  "passes": [
    { "name": "deterministic-rgb", "contentHash": "" },
    { "name": "gbuffer-world-position", "contentHash": "" },
    { "name": "gbuffer-normal", "contentHash": "" },
    { "name": "gbuffer-tracking-uv", "contentHash": "" },
    { "name": "gbuffer-instance-part", "contentHash": "" },
    { "name": "gbuffer-mask", "contentHash": "" },
    { "name": "gbuffer-motion", "contentHash": "" },
    { "name": "gbuffer-material", "contentHash": "" },
    { "name": "generative", "contentHash": "" }
  ],
  "masks": [
    { "name": "hard-lock", "contentHash": "" },
    { "name": "edit", "contentHash": "" }
  ],
  "scene": {
    "worldId": "world-apartment-livingroom",
    "assetRevisionIds": []
  },
  "condition": "B2"
}
```

`passes`는 그 실행이 실제로 넣은 채널만 포함한다. A에는 G-buffer 행이 없다. 행을 비워 둔 채 있는 것처럼 해시하지 않는다.

해시 함수는 평가 로그에서 SHA-256이다. `generateHash`의 FNV와 `temporaryPreservationHasher`의 정렬 JSON은 각각 샷 동일성과 보존 검사용으로 남아 있다. 셋은 역할이 다르다. provenance 한 줄로 합치지 않는다.

보증 문장:

- hard 마스크 안은 결정적 RGB 패스와 §1 허용오차 안에서 같다. 이 같음은 시드와 무관하다.
- hard 마스크 밖은 같은 provenance를 다시 실행하면 같은 생성 절차다. 픽셀이 비트 단위로 같다는 문장은 쓰지 않는다. 샘플러가 비트 일치를 보장하지 않으면 그 사실을 영수증 `message`에 적는다.
- 보호 영역의 비교 대상은 이전 최종 영상의 전체 프레임이 아니다. 이번 결정적 패스의 보호 마스크다.

## 6. 스크립트별 수준

### 악수 (H)와 컵 (P), 편집 전

- hard: 방 기하, 테이블 변환, 카메라, B의 얼굴, 신원 키, 컵 리비전.
- geometry: A·B 몸 포즈, 양손, 악수 접촉, 컵의 dynamic 변환과 부착, A의 대사 구간 얼굴.
- generative: 헤어 가닥, 옷의 고주파, 잠기지 않은 분위기 잔광.

### 손 편집 (E)

편집 명령이 추가로 고정하는 것:

- A의 포즈는 보존 해시가 같아야 하므로, 이 편집에 한해 A의 pose는 hard 비교(배열 동일)로 올라간다.
- 컵 변환과 두 컵 접촉은 `preserve`다.
- 카메라와 방은 이미 hard다.
- 재생성 허용은 B의 왼손과 아래팔, 그리고 그 팔이 악수에 닿도록 필요한 B의 팔 체인이다. 채점 마스크 `M`은 손과 아래팔이다. 팔 상박이 마스크 밖에서 포즈 허용오차를 넘으면 pose 실패다.
- B의 얼굴은 계속 hard다.

## 7. 정합 메모

월드 씬 v0 (`sceneStateSchema`, `schemaVersion: 1`)는 월드 레인이 소유한다. 모션 클립, 접촉 이벤트, 카메라 샘플은 그 스키마가 저장하지 않는다고 적혀 있다. 이 문서가 그 셋을 씬 객체에 새로 넣으라고 요구하지 않는다. 포즈는 퍼포먼스 플랜과 Backbone, 카메라는 샷 테이크와 연출 계약, 악수는 접촉 수출, 컵의 재질화된 부착만 씬의 `attachments`다.

샷 기록 (`Shot`, `schemaVersion: 1`)은 이 브랜치의 저장 문서다. `ShotModelInput` (`schemaVersion: 2`, `source: "editable_scene"`, `rasterKeyframes: "forbidden"`)은 거기서 파생된다. 모델 내부를 샷 필드에 넣지 않는다. Wan의 토큰 레이아웃, 어댑터 텐서 모양, DiT 블록 번호는 provenance의 `model.id`와 `weightsHash` 밖에 적지 않는다.

`sceneConditioning`은 그래프 경로의 이전 입력이다. `time.frameOrigin`은 샷의 `time.origin`과 같은 `"clip_local"`이다. 샷 기록이 있는 실행의 파생 입력은 `ShotModelInput`이다.

`coordinates.ts`는 fps의 권위를 아직 없는 타임라인 `Shot`으로 적는다. 권위는 이 브랜치의 `Shot.time.fps`다. 월드 씬은 fps를 저장하지 않고, 프레임 정수는 `ShotLocalFrame`이다.

프리뷰 증류본의 가중치 해시는 최종 `weightsHash`와 다르다. 둘을 한 `modelVersion` 문자열에 섞지 않는다. 최종 `ShotRender.modelVersion`은 전체 모델과 조건 이름(예를 들어 `Wan2.2-Fun-5B-Control-Camera+B2`)이 식별되게 적는다. 시드와 패스 해시는 `modelVersion`에 인코딩하지 않고 provenance 객체에 둔다.
