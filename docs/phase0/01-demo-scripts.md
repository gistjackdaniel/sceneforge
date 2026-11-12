# Phase 0 데모 스크립트

- 상태: 연구 레인 초안. 팀 확인 전 구현 계약이 아니다.
- 기준 브랜치: `feat/shot-record`
- 대상: 배우 2 + 소품 1 + 방 1 + 카메라 1, 5–10초
- 관련 문서: [평가 프로토콜](02-evaluation-protocol.md), [편집·보호 속성](03-editable-protected-attributes.md)

한 샷 안에서 세 가지를 증명한다.

1. A와 B가 악수한다.
2. A가 컵을 테이블에 내려놓는다. 컵은 dynamic이다. 매 프레임 월드 변환과 손 부착이 둘 다 있다.
3. B의 악수 손만 바꾸고, A와 카메라와 방은 잠근다.

데모의 합격은 영상을 다시 만드는 일이 아니다. 무엇을 바꿨고 무엇을 보존했는지 샷 기록과 씬 상태로 설명되고, 출력에서 그 설명이 확인되어야 한다.

## 1. 공통 셋업

### 1.1 시계

연구 수출의 기준 시계는 하나다.

| 필드 | 값 |
| --- | --- |
| `Shot.time.fps` | `16` |
| `Shot.time.durationFrames` | `128` |
| `Shot.time.origin` | `"clip_local"` |
| 벽시계 | 8.0초. 5–10초 범위 안이다. |
| 프레임 | `[0, 128)`. 끝 프레임은 배타다. |
| 마지막 샘플 인덱스 | `127` |

`16`은 `backboneCameraSchema` / `backbonePoseSchema`의 기본 `fps`와 같고, 카메라 빌더 테스트가 쓰는 시계와 같다. `24`는 `Shot.time.fps`로 유효하고 `sceneConditioning`의 기본값이기도 하다. 같은 8.0초를 24 fps로 남기면 `durationFrames`는 `192`이고, 이 문서의 프레임 번호에 `3/2`를 곱한다. 한 샷 안에서 16과 24를 섞지 않는다.

Backbone 기본 `num_frames` 81은 스키마 기본값일 뿐이다. 이 샷의 수출은 `num_frames: 128`이다. 월드 픽스처의 컵 구간 `[0, 40)` / `[40, 81)`은 짧은 예이고, 아래 타임라인이 이 샷의 구간이다.

초는 `frame / Shot.time.fps`다. 월드 씬은 fps를 저장하지 않는다. `ShotLocalFrame`은 정수이고, 초 환산은 샷 기록이 소유한다.

### 1.2 등장

식별자는 `persistentIdSchema`에 맞는 읽기 쉬운 예다. 신규 발급은 `act_<ULID>`, `obj_<ULID>`, `ast_<ULID>`, `cam_<ULID>`다. 샷 주체 id와 씬 인스턴스 id는 오늘 코드가 서로 가리키게 강제하지 않는다. 이 데모 수출에서는 같은 문자열을 쓴다.

| 역할 | id | 저장 위치 | 값 |
| --- | --- | --- | --- |
| 방 | `world-apartment-livingroom` | `WorldAsset.id`, `SceneState.worldId`, `Shot.environment.worldId` | 실내 세트. `representation`은 `mesh` 또는 `usd_stage`. 이미지·비디오 프록시는 `prepareModelInput`이 `proxy_world`로 막는다. |
| 세트 에셋 | `setAssetRef` | `SceneState.setAssetRef` | 방 메시 리비전. `assets[].kind = "set"`. |
| 배우 A | `actor-a` | `SceneState.actors`, `Shot.subjects` | `type: "actor"`, `label: "A"`, `skeleton.model: "smplx"`, `betas` 길이 10. 샷에서는 `kind: "human"`. |
| 배우 B | `actor-b` | 위와 같음 | `label: "B"`. A와 다른 `assetRef`. |
| 테이블 | `object-table` | `SceneState.objects` | `role: "set_piece"`, `motionMode: "static"`. 방의 일부로 잠긴다. 소품 개수에 넣지 않는다. |
| 컵 | `object-cup` | `SceneState.objects`, `Shot.subjects` | `role: "prop"`, `motionMode: "dynamic"`. 샷에서는 `kind: "object"`. |
| 카메라 | `cam-take-01` | `Shot.camera`가 `status: "ready"`일 때의 `selectedTakeId` | `source: "record"`. 휴대폰 6DoF 테이크. |

좌표는 `SCENE_COORDINATE_CONTRACT`를 따른다. 오른손잡이(right-handed), Y-up, 정면 `+Z`, 단위 미터, 회전 저장 `quaternion_xyzw`, 카메라 로컬은 GL, 수출 카메라는 OpenCV `c2w`. `WorldAsset.coordinateSystem`과 `unitScaleMeters`는 소스 파일 축이고, 수입 때 한 번 이 계약으로 바뀐다.

A는 원점 근처, B는 약 `+X` 1 m, 테이블은 둘 사이 앞쪽, 컵은 시작 시 A의 왼손이다. 정확한 미터 값은 샷의 `placement`와 `restTransform`에 남고, 이 문서의 성공 기준은 그 값과의 오차로 판정한다.

### 1.3 카메라와 연출 계약

샷 카메라:

- `Shot.camera.status = "ready"`
- `Shot.camera.interpolation`은 `linear` 또는 `catmull_rom`
- `Shot.camera.lens.focalLengthMm`는 양수. 데모 기본은 35.
- `CameraTake.source = "record"`
- `CameraTake.keys[]`: `frame`, `position`, `rotation` (쿼터니언 `[x, y, z, w]`), `focalLengthMm`, 선택적 `focusDistanceM`, `aperture`

연출 계약 (`directionContract`, `version: 2`):

- `separationPolicy: "shot_and_performance"`
- `shot.source: "3d_previs"`
- `shot.keyframes[].rotationQuaternion`. 샷 기록의 필드명은 `rotation`이다. 수출 때 값만 옮긴다.
- `shot.continuity.lineOfActionLabel = "A → B"`
- `shot.continuity.lineActorAId = "actor-a"`
- `shot.continuity.lineActorBId = "actor-b"`
- `shot.continuity.cameraSide = "left"`
- `shot.continuity.screenDirection = "left_to_right"`
- `shot.allowedSignals`에 `composition`, `camera_motion`, `lens`, `spatial_staging`, `screen_direction`, `action_boundaries`를 둔다.
- `shot.ignoredCharacterSignals`는 `body_mechanics`, `contact`, `facial_performance`, `cloth_motion`, `previs_interpolation`이다. 악수와 컵 접촉은 연출 계약의 샷 쪽에 실리지 않는다.

연속성 검사는 `validateCameraContinuity`다. `cameraSide: "left"`이면 위반 프레임이 `violationFrames`에 남고, 성공 테이크의 `status`는 `valid`다.

Backbone 카메라 수출 (`version: "0.1"`, `convention: "opencv_c2w"`)은 테이크 키를 프레임마다 샘플한 `frames[].t`, `K`, `c2w`다. `metadata.continuity`에는 `lineOfActionLabel`, `cameraSide`, `screenDirection`이 따라간다. `metadata.lookAtTargetElementId`는 샷이 look-at을 쓸 때만 채운다.

채널 잠금의 기본값은 `channelControls.camera.locked = true`, `channelControls.structure.locked = true`다.

### 1.4 포즈가 들어오는 길

사람 포즈의 권위는 `PerformancePlanNode`다. 클립 `clipId`의 노드 id는 `performancePlanNodeIdForClip`이 만드는 `node-${clipId}-performance`다.

`PerformancePlanParams`:

- `schemaVersion: 1`
- `separationPolicy: "shot_and_performance"`
- `sources[]`: `id`, `type`, `label`, `uri`, `enabled`, `qualityGate`
- `cues[]`: `kind`, `startFrame`, `endFrame` (끝 배타), `actorId`, `targetActorId`, `sourceId`
- `audioGuide`: A의 짧은 대사. 입 모양이 누구 것인지 실패 모드로 보게 한다.
- `channelControls`

소스 타입의 현재 열거형은 `text_prompt`, `live_action`, `motion_capture`, `key_animation_2d`다. 캡처 테이크는 `motion_capture`다. 음성에서 컴파일된 포즈는 그 타입이 아니다.

이 레인이 추가를 요청하는 값:

```json
{
  "id": "speech-motion-01",
  "type": "generated",
  "label": "speech-to-motion",
  "uri": "backbone://pose/shot-handshake-cup",
  "enabled": true,
  "notes": "컵은 여기 둘게.",
  "qualityGate": { "status": "unreviewed", "contactConfidence": 1 }
}
```

`generated`는 오늘 `PERFORMANCE_SOURCE_TYPES`에 없다. `normalizeSource`는 모르는 `type`을 `text_prompt`로 바꾼다. 열거형이 늘기 전에 저장 플랜에 `generated`를 쓰면 음성 모션이 텍스트 포즈로 오인된다. 연구 수출 JSON에는 적되, 에디터 저장 플랜에는 열거형 확장 뒤에 쓴다.

포즈 본문은 Backbone v0.1 `backboneHumanPoseSchema`다. `model: "smplx"`, `betas` 길이 10, 프레임마다 `global_orient`, `transl`, `body_pose` (63), `left_hand_pose` (45), `right_hand_pose` (45), `jaw_pose` (3), `expression` (10). 손 조인트 기본 매핑은 `SMPLX_PART_JOINT`다. `right_hand`는 `right_wrist`, `left_hand`는 `left_wrist`다. 리비전이 `rig.partMap`을 주면 그 매핑이 이긴다.

A의 대사 큐:

- `kind: "dialogue"`, `actorId: "actor-a"`, `startFrame: 8`, `endFrame: 40`
- `audioGuide.transcript: "컵은 여기 둘게."`, `offsetFrame: 8`
- B에게는 dialogue 큐를 두지 않는다.

### 1.5 컵은 dynamic

컵은 키 두 개로 줄이지 않는다. 비디오 모델이 중간 경로를 지어내게 두는 입력은 이 스크립트의 실패다.

동시에 있어야 하는 것:

1. `objects["object-cup"].motionMode = "dynamic"`. 스키마 주석대로 이 값은 비디오 레인이 예약했고, 월드 레인은 모드만 기록한다. 솔버는 여기서 돌지 않는다.
2. 매 프레임 월드 변환. Backbone `backboneObjectPoseSchema.frames[]`의 `t`와 `T_world_obj`가 `t = 0..127`에 빠짐없이 있다. `asset_uri`는 컵 리비전의 `uri`다.
3. 손 부착. `attachments[]`는 컵 객체 위에 있다.

부착 두 개. `frameRange`는 `[start, end)`다.

| 구간 | `parentInstanceId` | `rigPart` | `sourceContactId` |
| --- | --- | --- | --- |
| `[0, 48)` | `actor-a` | `left_hand` | `cup_hold_01` |
| `[48, 128)` | `object-table` | 생략 | `cup_place_01` |

부모가 배우이면 `rigPart`는 필수다. 부모가 오브젝트이면 `rigPart`를 두면 스키마가 거절한다. 테이블 부착에는 `rigPart`를 넣지 않는다.

`[0, 48)` 동안 `T_world_obj`는 부모 파트 월드 변환에 `offset`을 곱한 결과와 맞아야 한다. 제안 허용오차는 위치 5 mm, 회전 2°다. `[48, 128)` 동안 `T_world_obj`는 테이블 부착과 같은 상수다. `[32, 48)`은 손이 아직 부모인 채로 컵이 내려가는 구간이라 프레임마다 값이 바뀐다.

샷 기록의 `Motion`은 이 스트림을 그대로 담지 못한다. `channel: "explicit"`의 키는 희소하고 `provenance.kind`는 `"keyed"`뿐이다. 연구 수출의 권위 있는 컵 궤적은 Backbone 오브젝트 프레임이고, 샷 키는 그 스트림의 요약이다. 평가 입력에서 컵 경로를 샷 키 두 개로 대체하지 않는다.

## 2. 타임라인

fps 16, 128프레임.

| 구간 | 프레임 | 초 | 사건 |
| --- | --- | --- | --- |
| 접근 | `[0, 32)` | 0.0–2.0 | A가 왼손에 컵을 들고 B에게 다가간다. A가 말한다. |
| 내려놓기 | `[32, 56)` | 2.0–3.5 | 컵이 테이블로 내려간다. 프레임 48에서 부모가 손으로 바뀌어 테이블이 된다. |
| 손 준비 | `[56, 72)` | 3.5–4.5 | 컵은 테이블에 있다. A와 B가 각자 오른손을 올려 악수를 준비한다. |
| 악수 | `[72, 112)` | 4.5–7.0 | `handshake_01`. 성공 테이크는 A `right_hand`, B `right_hand`. |
| 해제 | `[112, 128)` | 7.0–8.0 | 손이 떨어진다. 컵과 카메라는 유지. |

악수 접촉은 오브젝트 `attachments`가 아니다. 양 배우의 손은 접촉 그래프 레코드다. `SceneState`는 모션 클립, 접촉 이벤트, 카메라 샘플을 저장하지 않는다고 명시한다. `sourceContactId`는 그 그래프를 가리키는 이름이다. 컵의 `cup_hold_01`, `cup_place_01`도 같은 이름의 접촉을 가리키고, 부착은 월드 씬이 붙들고 있는 재질화된 포즈다.

연구 수출의 악수 레코드. 이 객체는 `sceneStateSchema`에 없다.

```json
{
  "id": "handshake_01",
  "kind": "hand_hand",
  "actorId": "actor-a",
  "rigPart": "right_hand",
  "targetActorId": "actor-b",
  "targetRigPart": "right_hand",
  "frameRange": [72, 112]
}
```

대응하는 퍼포먼스 큐는 `kind: "action"`, `actorId: "actor-a"`, `targetActorId: "actor-b"`, `startFrame: 72`, `endFrame: 112`, `sourceId: "speech-motion-01"`다. 큐에는 `rigPart` 필드가 없다. 손은 접촉 레코드와 Backbone `left_hand_pose` / `right_hand_pose`에 있다.

보존 판정은 `StateSelector`를 쓴다.

- `camera_track`
- `actor_motion` (`actorId`)
- `actor_root_motion` (`actorId`)
- `set_layout`
- `contact` (`contactId`)
- `instance_identity` (호출자가 빼도 검사는 항상 보존으로 본다)

로드맵 예시의 보존 목록은 A의 루트 모션이다. 이 데모는 사용자 요구에 맞춰 A의 포즈 전체를 `actor_motion`으로 보존한다. 루트만 같으면 합격이 아니다.

## 3. 스키마 정합

이 브랜치와 월드 씬 v0에 있는 이름을 그대로 쓴다. 없는 이름은 수출 메모로 두고 저장 스키마에 몰래 넣지 않는다.

| 연구 개념 | 현재 필드 | 이 데모에서의 처리 |
| --- | --- | --- |
| 월드 | `WorldAsset.id` = `SceneState.worldId` = `Shot.environment.worldId` = `ShotModelInput.environment.worldId` | 같은 문자열 `world-apartment-livingroom`. |
| 모델 입력 | `ShotModelInput` `schemaVersion: 2`, `source: "editable_scene"`, `rasterKeyframes: "forbidden"` | 샷 기록에서 `prepareModelInput`으로만 만든다. 래스터 키프레임은 넣지 않는다. |
| 오래된 조건 문서 | `sceneConditioning.time.frameOrigin` | 의미는 `Shot.time.origin`의 `"clip_local"`과 같다. 필드명만 다르다. 샷 기록이 있는 수출은 `origin`을 쓴다. |
| 주체 종류 | 샷 `kind: "human" \| "object" \| "light"`. 씬 `type: "actor" \| "object"`. 조건 문서 `kind: "actor" \| "prop" \| "light"` | 바인딩 표(§1.2)로 대응한다. 사람을 `prop`으로 보내지 않는다. |
| 변환 | 샷 `placement`: `position`, `rotationEuler`, `scale`. 씬 `restTransform`: `translation`, `rotation` 쿼터니언, `scale` | 샷은 오일러를 유지한다. 샷 기록 결정은 오브젝트 회전을 쿼터니언으로 저장하지 않는다. 씬과 Backbone은 쿼터니언과 `T_world_obj`다. |
| 컵 궤적 | 샷 `Motion` 희소 키, `provenance.kind: "keyed"`. 오브젝트 트랙 `objectTrackSchema.keyframes`도 희소, 회전은 오일러. | 평가용 매 프레임 값은 `T_world_obj`. |
| dynamic | `motionMode: "static" \| "keyframed" \| "dynamic"` | 컵은 `dynamic`. 테이블은 `static`. |
| 손 부착 | `attachments[]`의 `parentInstanceId`, `rigPart`, `offset`, `frameRange`, `sourceContactId` | 컵에만 둔다. 악수는 접촉 그래프. |
| 악수 손 | `PerformanceCue`에 `rigPart` 없음. `StateSelector`는 배우 단위 | 접촉 수출 레코드와 손 포즈 채널로 손을 지정한다. |
| 음성 모션 | `motion_capture`는 캡처. `generated` 없음 | 수출에만 `generated`. 저장 플랜은 열거형 확장 후. |
| 카메라 회전 | `CameraKey.rotation`. 연출 계약 `rotationQuaternion`. Backbone `c2w` | 같은 테이크의 세 표기다. |
| 카메라 보간 | 샷 `linear \| catmull_rom`. 그래프 경로에만 `bezier` | 샷 기록을 따른다. `bezier`는 이 수출에 쓰지 않는다. |
| 채널 잠금 | `camera`, `structure`, `performance_body`, `performance_face`, `audio` | 배우 한 명의 손만 잠그는 채널은 없다. 손 범위는 편집 마스크와 접촉 id로 측정한다. |
| 신원 | 씬 `assetRef` + `betas` + 인스턴스 id. 샷 `assetId` + `assetVersion` | 둘 다 남긴다. `instance_identity`는 항상 보존. |
| 해시 | `generateHash`는 표시 이름, 테이크 이름, 렌더 영수증을 빼고 FNV로 `time`, `worldId`, 주체, 카메라 키를 접는다 | 재현용 출처 해시는 [속성 문서](03-editable-protected-attributes.md)의 확장이다. `generateHash`만으로 시드와 패스를 증명하지 않는다. |

`coordinates.ts` 주석은 정규 fps가 아직 트리에 없는 타임라인 `Shot`을 가리킨다. 이 브랜치의 샷 기록에 `Shot.time.fps`가 있다. fps의 권위는 샷 기록이다. 월드 씬은 계속 fps를 저장하지 않는다.

## 4. 스크립트 H — A와 B의 악수

### 셋업

공통 셋업을 그대로 쓴다. 성공 테이크의 접촉:

- `handshake_01.rigPart = "right_hand"`
- `handshake_01.targetRigPart = "right_hand"`
- 구간 `[72, 112)`
- A의 `right_hand_pose`와 B의 `right_hand_pose`가 그 구간의 클래스프를 만든다.
- B의 `left_hand_pose`는 이 접촉에 쓰이지 않는다.
- 컵은 이미 `[48, 128)`에서 테이블 부모다. 악수 손이 컵을 다시 집지 않는다.

퍼포먼스 큐는 §2의 action 큐다. `channelControls.performance_body.locked`는 이 스크립트에서 `false`다. 포즈는 입력이고, 생성 모델이 손 선택을 다시 해석하지 않게 `strength`는 기본 0.85 이상으로 둔다. 얼굴은 대사 구간에서만 A에게 열린다. B의 `performance_face`는 이 샷에서 잠근다 (`locked: true`). B는 말하지 않는다.

### 타임라인

§2의 악수 행이 이 스크립트의 채점 구간이다. 접근과 컵 구간은 같은 샷에 있어도 악수 점수에 컵 궤적을 섞지 않는다. 접촉 오차는 `[72, 112)`만 본다.

### 입력

- `Shot` 한 건. `subjects`에 `actor-a`, `actor-b`, `object-cup`. `environment.worldId`.
- `SceneState` 한 건. 배우 둘, 컵, 테이블, `setAssetRef`.
- `PerformancePlanParams` 한 건. `motion_capture`가 있으면 캡처 참고로 두고, 채점 포즈의 소스는 `generated` 수출이다.
- 접촉 수출 `handshake_01`.
- `CameraTake` `cam-take-01`과 `directionContract.shot`.
- Backbone `humans` 둘, `objects`에 컵. 카메라는 `frames` 128개.

`prepareModelInput`이 `no_selected_take` 또는 `proxy_world` 또는 `marker_only`를 반환하면 생성 전에 실패다. 마커만 있는 배우는 이 데모의 입력이 아니다. `representation`은 `mesh`다.

### 기대 출력

- 3D 프리뷰: 프레임 72–111에서 두 오른손이 맞닿고, 왼손은 악수에 들어가지 않는다.
- 최종 영상: 같은 손 쌍, 같은 카메라, A의 입이 대사 구간에만 움직이고 B의 입은 입력 `jaw_pose` / `expression`을 따른다.
- 영수증: `ShotRender.modelVersion`에 실제 모델이 적힌다. 스텁이면 `status: "stubbed"`이고 성공 샷으로 세지 않는다.

### 성공 기준

입력 계약 (렌더 전, 3D 상태):

- `handshake_01`의 두 `rigPart`가 모두 `right_hand`다.
- `[72, 112)`에서 두 `right_wrist` 사이 거리는 제안 5 cm 이하다.
- 같은 구간 손 메시 침투는 제안 5 mm 이하다.
- 구간 밖에서 손목이 그 거리 안에 머물면 접촉이 길어진 것으로 보고, 성공으로 치지 않는다.
- A의 `jaw_pose`와 `expression`은 대사 구간 `[8, 40)` 밖에서 레스트와 같다. B의 값은 샷 전체에서 레스트와 같다.

출력 계약 (영상, [평가 프로토콜](02-evaluation-protocol.md)의 허용오차):

- 접촉 시작·종료 프레임 오차, 접촉 위치, 침투가 contact 지표를 통과한다.
- A와 B의 얼굴·몸 재식별이 가림 이후에도 자신의 참조에 남는다.
- 추정 카메라가 입력 `c2w`에서 허용오차 안에 있다.
- B의 입 움직임이 A의 대사에 붙으면 실패다.

### 전형적 실패

| 실패 | 보이는 것 | 판정에 쓰는 신호 |
| --- | --- | --- |
| 접촉 침투 | 두 손바닥이 서로를 통과하거나, 손이 가슴 안으로 들어간다. | 손 메시 침투 깊이. 영상만일 때는 침투 합격으로 치지 않는다. |
| 틀린 신원의 손 | B의 왼손이 악수하거나, A의 손이 B의 클래스프를 대신한다. | `left_hand_pose`가 접촉 구간의 주 변화량인데 `targetRigPart`는 `right_hand`인 경우. 출력에서는 파트 ID 마스크의 왼손 영역이 편집·접촉 구간에 움직인 경우. |
| 틀린 신원의 입 | B의 입이 "컵은 여기 둘게"에 맞춰 움직인다. | B의 `performance_face`가 잠겨 있는데 출력 입 랜드마크가 대사 구간에서만 움직인다. |
| 신원 드리프트 | 교차나 가림 뒤 A의 얼굴이 B로 남는다. | 가림 후 재식별 순위가 바뀐다. `instance_identity` 해시는 입력에서 그대로여도 출력에서 깨질 수 있다. |
| 카메라 드리프트 | 후반 배경이 입력 궤적보다 밀린다. | 첫 프레임만 맞춘 뒤의 `c2w` 이동 오차가 후반에 커진다. 경로 전체를 유사 변환으로 맞춘 중앙값은 드리프트를 숨기므로 이 판정에 쓰지 않는다. |
| 편집 영역 밖 누출 | 악수 샷은 전신 생성이라 "편집"이 아니다. 누출 칸은 스크립트 E에서 채점한다. | 스크립트 H에서 방 재질이나 컵 위치가 입력과 달라지면 contact·identity 실패로 적고, locality 게이트로 넘기지 않는다. |

## 5. 스크립트 P — A가 컵을 테이블에 내려놓는다

### 셋업

공통 셋업과 §1.5의 컵 계약이다. 성공은 아래 세 가지가 한 입력에 같이 있을 때다.

- `motionMode: "dynamic"`
- `T_world_obj` 128개
- `cup_hold_01` 부착 (`rigPart: "left_hand"`, 부모 `actor-a`)과 `cup_place_01` 부착 (부모 `object-table`, `rigPart` 없음)

컵을 드는 손은 A의 왼손이다. 악수 손은 오른손이라 같은 샷에서 두 접촉이 손을 공유하지 않는다. 월드 픽스처는 컵을 B의 `left_hand`에 붙여 두었다. 그 픽스처는 스키마 예이고, 이 데모의 연기는 A가 내려놓는 쪽이다.

### 타임라인

| 프레임 | 컵의 권위 |
| --- | --- |
| `[0, 32)` | 왼손 부착. `T_world_obj`가 손과 함께 이동한다. |
| `[32, 48)` | 아직 부모는 손. `T_world_obj`가 테이블을 향해 프레임마다 바뀐다. |
| `48` | 첫 테이블 부모 프레임. `sourceContactId`가 `cup_place_01`로 바뀐 구간이 시작한다. |
| `[48, 128)` | 테이블 부착. `T_world_obj` 상수. 손과의 부모 관계는 없다. |

### 입력

스크립트 H와 같은 샷 파일이다. 채점기가 컵에서 읽는 필드:

- `SceneState.objects["object-cup"].motionMode`
- `attachments[0]`과 `attachments[1]`
- Backbone `objects[]` 중 `id`가 `object-cup`인 `frames`
- 샷 주체 `object-cup`의 `motion.channel`. `explicit`이면 키는 요약이다. `text`이거나 `unset`이면 컵 경로의 권위로 쓰지 않는다.

### 기대 출력

- 프리뷰에서 컵이 손에서 테이블로 옮겨지고, 프레임 48 이후 테이블 위에 머문다.
- 최종 영상에서 컵의 실루엣이 입력 `T_world_obj`를 입력 카메라로 투영한 궤적과 맞는다.
- 테이블과 방 메시 리비전은 바뀌지 않는다.

### 성공 기준

입력 계약:

- `motionMode`가 `dynamic`이다. `static`이나 `keyframed`만 있으면 실패다.
- `frames.length === 128`이고 `t`가 `0..127`을 빠짐없이 채운다.
- `[0, 48)`의 각 프레임에서 `T_world_obj`와 손 부착의 차는 위치 5 mm, 회전 2° 이내다.
- `[48, 128)`의 각 프레임에서 `T_world_obj`와 테이블 부착의 차가 같은 허용오차 안이고, 프레임 간 이동이 1 mm 이하다.
- 테이블 부착 객체에 `rigPart`가 없다.
- 프레임 48 이후 컵과 테이블 메시 침투는 5 mm 이하고, 컵 바닥과 상판의 틈은 1 cm 이하다.

출력 계약:

- 접촉 시작 프레임(테이블에 안착하는 48)의 오차가 contact 지표의 프레임 허용오차 안이다.
- 안착 위치 오차와 침투가 같은 지표를 통과한다.
- 컵이 공중에 멈추거나 상판을 통과하면 실패다.
- 컵의 겉모습이 다른 소품으로 바뀌면 identity 실패다.

### 전형적 실패

| 실패 | 보이는 것 | 판정 |
| --- | --- | --- |
| 접촉 침투 | 컵이 상판 아래로 꺼지거나, 내려놓는 동안 손 메시 안에 컵이 묻힌다. | 메시 침투 깊이. 부착 오프셋만 맞고 메시가 겹치면 실패다. |
| 희소 키만 있는 컵 | 키가 프레임 0과 48뿐이고 중간 `T_world_obj`가 없다. | 입력 계약 실패. 모델을 돌리기 전에 탈락한다. |
| 부착만 있고 궤적이 없음 | `attachments`는 있는데 `frames`가 비어 있다. | 같은 탈락. dynamic은 모드 플래그와 궤적이 같이 있어야 한다. |
| 틀린 손 | B의 손이나 A의 오른손이 컵을 내려놓는다. | 부모 `actor-b`, 또는 `rigPart`가 `left_hand`가 아님. |
| 신원 드리프트 | 가림(몸통이 컵을 가림) 뒤 컵의 색·형태가 바뀐다. | 컵 참조와의 재식별, 파트 ID `object-cup`의 마스크 일관성. |
| 카메라 드리프트 | 내려놓는 동안 시점이 입력 궤도에서 벗어난다. | 스크립트 H와 같은 카메라 오차. |
| 편집 영역 밖 누출 | 이 스크립트는 컵과 A의 왼팔이 움직이는 생성이다. 방 벽과 B의 몸이 따라 바뀌면, 부분 편집 샷이 아니라도 잠긴 `set_layout`과 B의 `actor_motion` 이탈로 기록한다. | 스크립트 E의 locality 공식을 미리 적용할 수 있다. 게이트 G3의 채점 샷은 E다. |

## 6. 스크립트 E — B의 접촉 손만 수정

### 셋업

스크립트 H/P의 성공 테이크를 편집 전(`edit-before`)으로 둔다. 편집 명령은 하나다.

> B가 왼손으로 악수하게 바꿔. A와 카메라와 방은 그대로 둬.

연구 수출에 남기는 조작:

```json
{
  "shot_id": "shot-handshake-cup",
  "operation": "change_contact_effector",
  "actor_id": "actor-b",
  "target_actor_id": "actor-a",
  "contact_event_id": "handshake_01",
  "new_effector": "left_hand",
  "preserve": [
    { "kind": "camera_track", "cameraTrackId": "cam-take-01" },
    { "kind": "actor_motion", "actorId": "actor-a" },
    { "kind": "set_layout" },
    { "kind": "contact", "contactId": "cup_place_01" },
    { "kind": "contact", "contactId": "cup_hold_01" },
    { "kind": "instance_identity" }
  ],
  "recompute": [
    { "kind": "actor_motion", "actorId": "actor-b" },
    { "kind": "contact", "contactId": "handshake_01" }
  ]
}
```

`new_effector`와 `operation`은 로드맵의 개념 필드다. `StateSelector`에 있는 이름은 `preserve` / `recompute` 쪽이다. 편집 후 `handshake_01.targetRigPart`는 `left_hand`이고 A의 `rigPart`는 `right_hand` 그대로다.

B의 포즈를 전부 다시 뽑되, 채점 마스크는 B의 `left_hand`와 그 팔이다. 오늘 `StateSelector`에는 파트 단위 모션이 없고 `performance_body`는 몸 전체 채널이다. 그래서 3D 재계산은 B의 `actor_motion`으로 넓고, 영상 채점은 손·팔 마스크로 좁다. B의 얼굴, 골반 이동, 오른손(이제는 쉬어야 하는 손)은 포즈 허용오차 안에 남아야 한다. 허용오차를 넘는 B의 몸통 변화는 손 편집의 성공으로 치지 않는다.

잠금:

- A: `actor_motion` 해시가 `edit-before`와 같다. 루트만 같은 것은 부족하다.
- 카메라: `CameraTake.keys`와 Backbone `c2w`가 같다. `channelControls.camera.locked`는 `true`다.
- 방: `set_layout`과 테이블 `motionMode: "static"`, 방 `assetRef`가 같다. `channelControls.structure.locked`는 `true`다.
- 컵: `cup_hold_01`, `cup_place_01`, `T_world_obj`가 같다. 손 편집이 컵을 다시 집지 않는다.

`Subject.locked`는 샷 주체의 불리언이다. 속성 단위 잠금이 아니다. 이 스크립트의 잠금 권위는 `channelControls`와 `StateSelector`다.

### 타임라인

편집 전후는 같은 `fps`, 같은 `durationFrames`, 같은 프레임 구간이다. 바뀌는 연기 구간은 `[56, 128)`이다. `[56, 72)`에 B의 왼손이 올라오고, `[72, 112)`에 왼손 악수, `[112, 128)`에 해제다. `[0, 56)`의 B 포즈도 가능하면 유지한다. 컵을 받는 연기가 없기 때문이다.

무효화 힌트로 쓸 수 있는 기존 필드는 `DirectionChannelInvalidation`이다. `channel: "performance_body"`, `frameRanges: [{ startFrame: 56, endFrame: 128 }]`. 이 범위는 B만 가리키지 못한다. 부분 재생성의 픽셀 범위는 아래 마스크가 정한다.

편집 마스크 `M`:

- 결정적 렌더의 파트 ID에서 B의 `left_hand`와 아래팔.
- 평가 해상도에서 8픽셀 팽창. 경계 안티앨리어싱을 누출로 세지 않기 위함이다.
- A, 방, 테이블, 컵, B의 머리, B의 오른손은 `M` 밖에 있다.

### 입력

- `edit-before` 샷과 씬, 포즈, 카메라.
- 위 조작 JSON.
- `edit-after`의 B 포즈와 `handshake_01`.
- 같은 `generateHash` 입력 중 B의 `motion`만 달라진다. 해시가 바뀌는 것이 맞다. 카메라와 A와 `worldId`는 해시 입력에서 동일하다.

### 기대 출력

- 프리뷰: B의 악수 손이 왼손이다. A의 포즈 곡선, 카메라 키, 방과 컵의 변환은 바뀌지 않는다.
- `temporaryPreservationCheck` 계열의 보존 보고에서 `preserve` 행은 `ok`, `recompute` 행은 변경이 기대값이다.
- 최종 영상: `M` 안에서 손이 바뀌고, `M` 밖 픽셀 변화는 locality 허용오차 안이다.
- 보호 영역(방, A, 카메라가 보는 고정 배경)은 결정적 패스와 같아야 한다. 프레임 전체의 픽셀 일치는 요구하지 않는다. 기준은 [속성 문서](03-editable-protected-attributes.md)의 hard 잠금이다.

### 성공 기준

3D:

- `handshake_01.targetRigPart === "left_hand"`, A 쪽은 `right_hand`.
- A의 Backbone 프레임 배열이 `edit-before`와 같다.
- 카메라 샘플이 같다.
- `setAssetRef`와 테이블·컵의 `T_world_obj`가 같다.
- B의 `left_wrist`가 `[72, 112)`에 A의 `right_wrist`와 5 cm 안에 있고, B의 `right_wrist`는 그 접촉 거리 밖에 있다.
- B의 `expression`과 `jaw_pose`는 `edit-before`와 같다.

영상:

- edit locality: `M` 밖 LPIPS와 픽셀 변화가 프로토콜 허용오차 안이고, `M` 안에서는 손이 실제로 바뀌어 있다. 밖이 가만히 있고 안도 그대로면 편집 실패다.
- A의 재식별과 포즈 오차가 편집 전과 같은 합격 구간에 있다.
- 카메라 오차가 편집으로 늘지 않는다.
- 방의 hard 잠금 영역이 결정적 패스와 같다.

### 전형적 실패

| 실패 | 보이는 것 | 판정 |
| --- | --- | --- |
| 접촉 침투 | 왼손 악수에서 손이 서로를 통과한다. | contact 침투. 손을 바꾼 것만으로 면제되지 않는다. |
| 틀린 신원 손 | A의 손까지 왼손으로 바뀌거나, B의 오른손이 여전히 악수한다. | A의 `actor_motion` 해시 변화, 또는 B `right_hand`가 접촉 거리 안에 있음. |
| 틀린 신원 입 | 손만 바꾸라고 했는데 B 또는 A의 입이 다시 움직인다. | 잠긴 `performance_face`와 `jaw_pose` 이탈. |
| 신원 드리프트 | 손 재생성 뒤 B의 얼굴이 젊어지거나 A와 섞인다. | 가림이 없는 프레임에서도 얼굴 재식별이 떨어지면 드리프트다. 가림 후 수치는 프로토콜의 after-occlusion 칸에 따로 적는다. |
| 카메라 드리프트 | 잠긴 테이크인데 출력 시점이 이동한다. | 편집 전후 출력의 카메라 오차 증가, 또는 입력 `c2w`와의 오차. |
| 편집 영역 밖 누출 | 벽 텍스처, A의 옷, 컵, 테이블 그림자가 `M` 밖에서 달라진다. | `M` 밖 평균 절대 픽셀 차와 LPIPS. 컵이 `M` 밖에 있으므로 컵 변화는 누출이다. |

## 7. 공통 운영

세 스크립트는 한 샷 `shot-handshake-cup`의 성공 테이크(H+P)와 그 테이크의 손 편집(E)이다. 평가 세트가 카메라와 가림을 바꿀 때도 접촉 id, 부착 구간, 잠금 목록의 형태는 유지한다. 프레임 번호는 시계를 16 fps로 고정한 뒤에만 비교한다.

실패 샷은 모델 출력만의 일이 아니다. `T_world_obj` 누락, `rigPart`를 테이블 부착에 넣은 경우, `generated`를 저장 플랜에 미리 써 `text_prompt`로 바뀐 경우는 렌더 전 실패로 기록한다.
