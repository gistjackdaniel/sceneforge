# Phase 0 — Backbone Research

3D가 Source of Truth이고, 비디오 모델은 그 위를 그리는 선택적 렌더러다. 이 폴더는 그 전제를 한 샷으로 고정하는 연구 레인 문서다. 코드 변경은 포함하지 않는다.

대상 샷은 배우 2, 소품 1, 방 1, 카메라 1, 길이 5–10초다. 시계는 `Shot.time.fps`만 쓴다. 이 샷은 `16`, `durationFrames = 128` (8.0초)이다.

| 문서 | 내용 |
| --- | --- |
| [01-demo-scripts.md](01-demo-scripts.md) | 악수, 컵 내려놓기, B의 접촉 손만 수정. 각 스크립트의 셋업, 타임라인, 입력, 기대 출력, 성공 기준, 실패 모드. |
| [02-evaluation-protocol.md](02-evaluation-protocol.md) | identity, pose, camera, contact, edit locality, cost의 측정법, 정성 루브릭, 평가 세트, 조건 실험 A/A'/B/C/D, 채택 게이트 G1–G3. |
| [03-editable-protected-attributes.md](03-editable-protected-attributes.md) | 속성별 hard / geometry / generative, 프리뷰와 최종 렌더의 책임, 출처 해시. |

권장 백본은 Apache 2.0 Wan 2.2이고, 출발 체크포인트는 `Wan2.2-Fun-5B-Control-Camera`다. G-buffer 조건은 DAR의 tracking, world position, normal 주입을 따르되, 실험 B는 그 위에 instance/part ID, mask, motion vector, material을 더한다.

씬 스키마는 월드 레인의 `sceneStateSchema` (`schemaVersion: 1`)를 v0로 읽는다. 샷 필드는 이 브랜치의 `Shot` (`schemaVersion: 1`)과 `ShotModelInput` (`schemaVersion: 2`)을 쓴다. 팀이 닫은 다섯 가지(모션 소스 `generated`, 밀집 `T_world_obj`와 희소 `Motion` 베이크, `rigPartSchema`의 악수 손, `rotationEuler` / 쿼터니언 / OpenCV `c2w`, 컵의 초기 부모 A)는 [데모 스크립트](01-demo-scripts.md)의 결정·소유 표에 있다.
