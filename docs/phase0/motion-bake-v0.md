# 샷 Motion bake v0

희소한 샷 키는 평가용 궤적의 요약이다. 컵의 권위 있는 궤적은 Backbone `T_world_obj`이고, 샷 `Motion`은 그 스트림을 재생 오차 안에서 줄인 키만 담는다.

## 시계

- 프레임 `t`는 정수다. 초는 `t / Shot.time.fps`다.
- fps의 단일 출처는 `Shot.time.fps`다. bake 결과와 월드 씬은 fps를 저장하지 않는다.
- `t`가 정수가 아니거나 `[0, Shot.time.durationFrames)` 밖이면 그 샘플은 버린다. 반올림하지 않는다.
- 같은 `t`가 여러 번이면 마지막 샘플만 남긴다.

## 저장과 경계

- 키의 회전은 `rotationEuler`이고 순서는 `SHOT_EULER_ORDER` = `XYZ`다. Scene 레인 확정(StageViewport.tsx 기준).
- 계약 경계(`canonicalPlacement`, 씬 `restTransform.rotation`)는 쿼터니언 `[x, y, z, w]`다.
- `provenance.kind`는 `"keyed"`다. 보간은 `linear`다. 키 선택은 이 보간으로 다시 재생했을 때의 오차를 본다.

## 허용 오차

| 축 | 값 |
| --- | --- |
| 위치 | 5 mm (`0.005` m) |
| 회전 | 2°. 저장된 오일러를 쿼터니언으로 바꾼 뒤의 사이각 |
| 스케일 | 성분별 `1e-4` |

오차가 허용 이하이면 그 샘플은 키로 남기지 않는다.

## 키 선택

끝점은 항상 남긴다. 사이 샘플은 Douglas–Peucker다. 구간의 선형 재생이 허용 오차를 넘으면, 정규화 오차가 가장 큰 프레임을 키로 남기고 양쪽으로 다시 나눈다. 동점이면 더 작은 프레임 번호를 고른다. 같은 입력은 같은 키를 낸다.

## 카메라

이 문서의 bake는 오브젝트 변환만 다룬다. 카메라 수출은 Scene 레인 담당이고 표기는 Backbone `convention: "opencv_c2w"`의 `frames[].c2w`다. 샷 `CameraKey.rotation`은 쿼터니언이고, take id는 불투명 문자열이다. `take-${shotId}-${index}`를 이 변경에서 `cam_<ULID>`로 바꾸지 않는다.
