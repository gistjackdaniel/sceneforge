# SceneForge PRD — 최소 기능

이 문서가 현재 기준이다. 이전 통합 계획(노드 그래프, 부분 재렌더, 멀티컷 IDE)은 [docs/archive/sceneforge_PRD_full.md](docs/archive/sceneforge_PRD_full.md)에 보관한다. 최소 기능이 되기 전에는 그 범위를 구현하지 않는다.

## 한 줄

3D 자산으로 만든 사람과 사물에, 포즈와 카메라 궤적을 주면 일관된 비디오를 만든다.

```text
3D assets (human, object)
  + pose (text prompt 또는 explicit pose)
  + camera trajectory
  → multi-reference video model
  → video
```

비디오 백본은 멀티모달, 멀티 레퍼런스 프론티어 모델이다. 같은 3D 자산을 레퍼런스로 다시 넘기는 것이 일관성의 근거다. 모델 내부(토큰, DiT, correspondence)는 노출하지 않는다.

## 그래프는 최소 기능이 아니다

노드 그래프는 여러 컷이 노드를 공유하고, 바뀐 노드만 다시 렌더할 때 쓰는 구조다. 이번 범위는 샷 하나다. 의존성 그래프, 공유/인스턴스 참조, 부분 재렌더 승인, 그래프 편집 화면은 만들지 않는다.

샷에 필요한 기록은 목록이다.

| 필드 | 내용 |
|------|------|
| subjects | 사람·사물 3D 자산. 안정된 id, 종류, 파일 URI, 배치 |
| motion | 주체마다 하나. 텍스트 포즈 프롬프트 **또는** 프레임별 explicit pose |
| camera | 같은 시계 위의 카메라 궤적(위치, 회전, 렌즈) |
| time | fps, 길이(프레임), 클립 로컬 원점 |

이 기록이 재현 가능한 recipe다. 생성된 비디오 파일은 결과가 되고, 입력을 대체하지 않는다.

## 화면

한 화면만 둔다.

1. **Stage** — 3D 자산을 놓고 본다.
2. **Subjects** — 사람·사물을 고르고, 포즈 프롬프트를 쓰거나 Motion에서 explicit pose를 `K`로 남긴다.
3. **Camera** — Motion에서 궤적을 `K`로 남긴다.
4. **Generate video** — 자산, 포즈, 카메라 궤적을 모델에 보낸다.

World Gen, Direction, Graph, Inspector, Assistant, Timeline, Shot Workflow는 이 화면에서 빼 둔다.

## 생성 입력

`SceneConditioning`이 모델에 넘어가는 샷 기록이다.

- `source`는 `editable_scene`
- `rasterKeyframes`는 `forbidden` (화면 픽셀을 포즈로 쓰지 않는다)
- 각 subject의 `posePrompt`는 텍스트 포즈다. 비어 있으면 그 주체의 `objectTracks`가 explicit pose다
- `camera.keyframes`가 카메라 궤적이다
- 3D 자산 URI가 없는 마커만으로는 생성하지 않는다

커넥터는 이 기록을 프론티어 비디오 모델의 멀티 레퍼런스 입력으로 바꾼다. 모델이 바뀌어도 샷 기록의 필드는 바꾸지 않는다.

## 완료 조건

- 사람 또는 사물 3D 자산을 샷에 넣을 수 있다.
- 그 주체의 동작을 텍스트 프롬프트로 적거나, 프레임별 포즈로 남길 수 있다. 둘 중 하나만 있으면 된다.
- 카메라 궤적을 남길 수 있다. 궤적이 없으면 Generate는 막힌다.
- Generate는 같은 자산 id, 포즈, 카메라 궤적을 모델 입력으로 보낸다.
- 새로고침 후에도 자산, 포즈, 카메라가 남는다.

## 하지 않는 것

- 노드 그래프 UI와 그래프 런타임을 최소 기능의 전제로 두지 않는다
- 여러 컷 공유, 부분 재렌더, 퍼포먼스 플랜, OTIO
- 이미지 프록시를 3D 씬인 것처럼 인코딩
- 모델이 연결되기 전에는 스텁이 같은 입력 형태를 받고, 실모델이 없다는 것을 결과에 숨기지 않는다

## 검증 루프

`apps/editor`에서 `npx tsc -p tsconfig.json --noEmit`와 `npx vitest run`을 통과시킨 뒤, 화면에서 확인한다.

1. 화면은 Stage뿐이다. Graph, Inspector, Direction, World Gen, Timeline이 보이지 않는다.
2. 3D 자산(블록, 구체, 또는 GLB)을 추가하면 Subjects에 남고, 새로고침 후에도 남는다.
3. Pose prompt를 적으면 그 문장이 주체 기록에 남는다. 비우고 Motion에서 `K`를 누르면 explicit pose가 그 프레임에 남는다.
4. 카메라 키가 없으면 Generate video가 비활성이다. Motion에서 `K`로 궤적을 남기면 버튼이 켜진다.
5. Generate는 비디오 잡으로 이어지고, 실패하면 이유가 상단에 보인다.
