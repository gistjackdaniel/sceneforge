# Shot Direction / Performance Direction 시장 점검

기준일: 2026-08-31

## 결론

AI 영상 도구는 빠르게 `카메라`, `장면 구조`, `인물 포즈·퍼포먼스`, `오디오·편집 타이밍`을 각각 제어하는 방향으로 발전하고 있다. 그러나 대부분의 제품은 이 신호를 한 화면이나 한 생성 과정에서 함께 다루며, 러프 3D 프리비즈의 불완전한 캐릭터 움직임이 최종 연기로 번지는 것을 제품 차원에서 명시적으로 차단하지 않는다.

SceneForge의 기회는 3D 애니메이션을 더 정교하게 만드는 데 있지 않다. 다음 두 계약을 독립적으로 유지하는 데 있다.

- **Shot Direction Contract:** 구도, 정확한 카메라 위치·렌즈·경로, 공간 배치, 시선 축, 스크린 방향, 180도 규칙, 단순한 동작 경계만 전달한다.
- **Performance Direction Contract:** 텍스트 연기 지시, 라이브 액션 레퍼런스, 모션 캡처, 손으로 그린 2D 키 애니메이션과 편집된 오디오 타이밍만 전달한다.

러프 프리비즈의 바디 메카닉, 손·발 컨택, 표정, 의상 움직임, 보간된 이동 궤적은 명시적인 금지 신호로 취급해야 한다. 이렇게 해야 AI가 프리비즈의 영화 문법은 보존하면서도, 최종 퍼포먼스는 배우와 애니메이터가 만든 고품질 원본에서 가져올 수 있다.

## 관련 회사의 개발 방향

### Autodesk Flow Studio

Autodesk는 2026년 8월 3D Editor와 Canvas를 공개했다. 3D Editor는 캐릭터·환경·애니메이션·카메라를 편집 가능한 타임라인으로 다루고, Global/Relative Camera와 키프레임 트랙을 제공한다. Canvas는 이 3D 장면과 카메라 결정을 보존하면서 여러 생성 모델을 노드 기반으로 연결한다. Flow Studio의 마커리스 캡처 역시 얼굴·몸·손과 발 컨택 개선을 강조한다.

방향은 `정확한 3D 샷 설계 → 생성 렌더`의 통합이다. 다만 러프 프리비즈 애니메이션과 최종 연기 소스를 강제로 분리하는 정책은 전면에 드러나지 않는다. SceneForge는 같은 통합 구조를 더 가볍게 가져가되, 최종 연기에 사용할 수 없는 3D 신호를 데이터 계층에서 제거하는 것으로 차별화할 수 있다.

- [Introducing 3D Editor + Canvas in Autodesk Flow Studio](https://blogs.autodesk.com/media-and-entertainment/2026/08/04/introducing-3d-editor-canvas-in-autodesk-flow-studio/)
- [Autodesk Flow Studio product details](https://www.autodesk.com/products/flow-studio/product-details)

### Luma Ray3.2

Luma는 Motion, Structure, Bodies + Poses, Faces를 서로 독립적인 제어 축으로 제공한다. 소스 영상의 길이·프레이밍·편집·타이밍을 유지하고 특정 소스 프레임 인덱스에 키프레임을 배치할 수 있다. 특히 `Blocking`은 희소한 프리비즈 수준의 신체 방향, `Poses`는 더 강한 퍼포먼스 제어로 구분된다.

이는 SceneForge가 채널별 잠금과 강도를 가져야 한다는 직접적인 근거다. 카메라만 잠그고 퍼포먼스는 새로 만들거나, 반대로 승인된 퍼포먼스만 잠그고 장면 구조를 바꾸는 식의 재생성 범위가 필요하다.

- [Ray3.2 controls and workflows in depth](https://lumalabs.ai/learning-center/articles/ray-3-2-controls-and-workflows-in-depth)
- [Ray3.2 introduction and core concepts](https://lumalabs.ai/learning-center/articles/ray-3-2-introduction-and-core-concepts)

### NVIDIA MoRight

NVIDIA Research의 MoRight는 카메라 시점과 오브젝트 움직임을 이중 스트림으로 명시적으로 분리한다. 능동적인 객체 모션과 수동적인 카메라 관찰 변화를 분리해 학습하는 접근이다.

제품 수준의 시사점은 간단하다. 카메라와 퍼포먼스를 프롬프트 문장 안에서만 구분해서는 부족하다. 서로 다른 입력 스트림, 검증 규칙, 캐시 키를 가진 구조적 계약이어야 한다.

- [MoRight: Motion Control via Camera-Object Motion Disentanglement](https://research.nvidia.com/labs/sil/projects/moright/)

### Google Flow / Veo

Google Flow는 Camera Controls, Scenebuilder, 재사용 가능한 Ingredients를 제공하고, Veo는 대사와 음향을 포함한 네이티브 오디오 생성을 지원한다. 영화 제작 언어와 오디오가 생성 모델의 핵심 제어면으로 들어왔다는 의미다.

하지만 네이티브 생성 오디오는 편집자가 프리미어 등에서 확정한 오디오 가이드와 다르다. SceneForge는 샷별 오디오 파일, 오프셋, 길이, 대사·리액션 큐를 프레임 단위로 고정하는 쪽에 집중해야 한다.

- [Google Flow filmmaking tool](https://blog.google/innovation-and-ai/products/google-flow-veo-ai-filmmaking-tool/)
- [Google DeepMind Veo](https://deepmind.google/technologies/veo/)

### Runway Act-Two

Act-Two는 배우의 드라이빙 퍼포먼스 영상에서 말하기, 표정, 몸짓과 오디오를 캐릭터에 전이한다. 캐릭터 비디오를 입력하면 원래 환경과 카메라 움직임을 유지하는 등 입력 방식에 따라 카메라와 퍼포먼스의 결합 방식이 달라진다.

이는 라이브 액션 퍼포먼스가 강력한 독립 소스가 될 수 있음을 보여준다. SceneForge는 각 배우의 퍼포먼스 테이크를 특정 캐릭터와 타임 구간에 연결하되, 승인된 샷 카메라는 별도 계약으로 잠가야 한다.

- [Performance Capture with Act-Two](https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two)
- [Multi-character dialogues with Act-Two](https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two)

### Adobe Firefly / Premiere

Adobe는 레퍼런스 영상에서 카메라 모션을 추출해 생성 영상에 적용하고, Firefly 비디오 편집기의 멀티트랙 타임라인에서 자체 영상·생성 클립·음악·오디오를 함께 다루는 방향으로 확장하고 있다.

카메라 모션 레퍼런스와 편집 타임라인의 결합은 SceneForge의 전제와 일치한다. 차이는 SceneForge가 영상 레퍼런스뿐 아니라 정확한 3D 카메라·렌즈·스테이징 메타데이터와 퍼포먼스 출처를 함께 보존한다는 점이다.

- [Use video as a motion reference in Firefly](https://www.adobe.com/learn/firefly/web/video-motion-reference)
- [Add media to the Firefly video editor timeline](https://helpx.adobe.com/firefly/web/firefly-video-editor/add-and-organize-media/add-a-media-to-timeline.html)
- [Adobe video and Firefly updates](https://blog.adobe.com/en/publish/2026/04/15/adobe-extends-leadership-video-unleashing-new-ai-powered-creation-firefly-reinventing-color-editors-in-premiere)

### Epic Games MetaHuman / Sequencer

MetaHuman Animator는 오디오·영상·깊이 데이터에서 퍼포먼스를 생성하고, Unreal Sequencer는 카메라·오브젝트·캐릭터를 멀티트랙으로 편집한다. 고품질 퍼포먼스 자산과 샷 타임라인을 분리하는 검증된 제작 구조지만, 전체 3D 파이프라인의 무게가 크다.

SceneForge는 같은 책임 분리를 유지하면서 프리비즈를 영화 문법에 필요한 최소 수준으로 제한하고, 최종 렌더와 합성은 AI 모델에 맡기는 가벼운 경로를 지향한다.

- [MetaHuman Animator](https://dev.epicgames.com/documentation/metahuman/metahuman-animator-in-unreal-engine?lang=en-US)
- [Unreal Engine Sequencer overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-sequencer-movie-tool-overview)

## 제품 원칙

1. `Shot Direction`과 `Performance Direction`은 별도 노드, 별도 포트, 별도 검증 규칙으로 저장한다.
2. 3D 프리비즈는 정확한 카메라와 정적인 스테이징 앵커만 최종 생성 요청에 제공한다.
3. 프리비즈의 시간 보간된 캐릭터 궤적은 최종 생성 요청에서 제거한다.
4. 퍼포먼스는 텍스트, 라이브 액션, 모션 캡처, 2D 키 애니메이션 중 하나 이상의 출처와 연결한다.
5. 편집된 오디오는 URI, 클립 내 오프셋, 길이, 트랜스크립트와 프레임 단위 큐로 전달한다.
6. 대사와 대사 사이의 리액션, 홀드, 액션 비트도 명시적인 시간 구간으로 다룬다.
7. 렌더 결과는 어떤 카메라·퍼포먼스·오디오 버전을 사용했는지 추적 가능해야 한다.

## 2026-08-31 구현된 SceneForge 수직 슬라이스

- 클립마다 `PerformancePlanNode`를 생성하고 기존 프로젝트는 로드 시 자동 마이그레이션한다.
- Direction 패널에서 네 가지 퍼포먼스 소스, 편집 오디오 가이드, 대사·리액션·액션·홀드 큐를 관리한다.
- Camera Path의 프레임별 위치·회전·초점거리, Lens, Look-at, 라인 오브 액션, 카메라 측, 스크린 방향을 `Shot Direction Contract`로 만든다.
- 렌더 입력의 레거시 키프레임에서는 모든 캐릭터 오브젝트를 제거한다.
- Actor Placement는 시간 변화가 없는 정적 스테이징 앵커 한 개로만 전달한다.
- `body_mechanics`, `contact`, `facial_performance`, `cloth_motion`, `previs_interpolation`을 무시해야 할 신호로 명시한다.
- 활성화된 외부 퍼포먼스 소스와 프레임 단위 큐만 `Performance Direction Contract`에 포함한다.
- 퍼포먼스 또는 오디오 큐가 클립 범위를 벗어나면 렌더를 시작하기 전에 차단한다.
- Timeline에 CAM, AUD, PERF 트랙을 분리해 어떤 신호가 어디서 오는지 보이게 한다.

## 다음 개발 우선순위

1. **Connector capability negotiation:** 각 모델이 지원하는 카메라, 구조, 포즈, 얼굴, 오디오 제어를 선언하게 하고 공통 계약을 모델별 파라미터로 변환한다.
2. **채널별 Lock / Strength / Mask:** 카메라·구조·캐릭터별 퍼포먼스를 독립적으로 잠그고, 영향 강도와 재생성 범위를 지정한다.
3. **편집 교환:** Premiere XML/EDL과 OpenTimelineIO를 통해 샷 오디오, 타임코드, 마커를 가져오고 다시 내보낸다.
4. **180도 규칙 자동 검증:** 두 캐릭터의 배치로 라인 오브 액션을 계산하고 카메라가 보호 측을 넘는 키를 표시한다.
5. **퍼포먼스 소스 품질 게이트:** 모캡의 발 미끄러짐·컨택·관절 신뢰도와 라이브 액션 트래킹 품질을 검사해 낮은 품질의 소스를 경고한다.
6. **다중 캐릭터 큐:** 대사 주체, 리액션 대상, 오버랩, 선후 의존성을 캐릭터별로 연결한다.
7. **출처와 부분 캐시:** 렌더 결과에 사용한 계약 버전을 기록하고, 변경된 채널과 프레임 범위만 무효화한다.
8. **모델별 검증 장면:** 느린 감정 Push-In, 빠른 코미디 Push-In, 좁은 파이프 통과, 대사 사이 리액션을 고정 평가 세트로 만든다.

이 우선순위는 “일반적인 70%를 자동화하고 독창적인 30%의 인간 퍼포먼스를 보존한다”는 제품 목표를 직접 지원한다.

## 2026-09-01 후속 구현

초기 수직 슬라이스 이후 다음 제작 제어를 추가했다.

- **모델 capability negotiation:** Connector가 카메라·구조·바디·페이스·오디오 채널을 `unsupported`, `prompt`, `reference`, `exact`로 선언한다. Lock, Strength, Mask 지원 여부와 실제 적용 값이 렌더 계약 v2에 기록되며 지원하지 않는 소스와 타이밍 downgrade도 숨기지 않는다.
- **부분 재생성:** 캐시에 변경 채널과 clip-local 프레임 구간을 누적한다. 대사·리액션 큐 몇 프레임만 수정하면 전체 퍼포먼스가 아니라 그 구간의 body/face 채널이 다음 `rerenderScope`가 된다.
- **180도 자동 검증:** 두 Actor Placement를 라인 오브 액션으로 선택하고 모든 Camera Path keyframe을 XZ 평면에서 검사한다. 의도적 축 넘기는 허용하되 위반 프레임을 경고한다.
- **퍼포먼스 품질 게이트:** Live action과 motion capture 소스에 승인·거절 상태, tracking/contact confidence, foot sliding score를 저장한다. 거절된 소스는 렌더를 막고 낮은 품질은 경고한다.
- **다중 캐릭터 큐:** 각 cue에 actor, target actor, preceding/reaction cue, overlap policy를 연결한다. 끊어진 관계, 자기 참조, 순환 의존성, Avoid 정책 위반을 사전 검증한다.
- **OpenTimelineIO 왕복:** cue는 OTIO Marker, 편집 오디오는 ExternalReference로 내보낸다. 전체 Performance Plan은 OTIO 권고에 따라 `metadata.sceneforge` namespace에 저장해 SceneForge 재가져오기 시 손실 없이 복원한다. OTIO는 편집 컷과 외부 미디어 참조를 위한 교환 형식이며 미디어 컨테이너가 아니다. [OpenTimelineIO file format specification](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/otio-file-format-specification.md), [serialized schema](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/otio-serialized-schema.md)

Premiere XML/EDL은 OTIO와 동일한 무손실 형식으로 간주하지 않는다. 2026-09-01 수직 슬라이스에서는 Premiere가 사용하는 Final Cut Pro 7 `xmeml`의 sequence marker·편집 오디오·frame rate를 왕복하고, CMX 3600 EDL의 record timecode를 action range로 가져오도록 구현했다. SceneForge가 직접 내보낸 XML/EDL에는 cue와 audio metadata를 넣어 재가져오기 품질을 높인다. 일반 편집 파일을 가져올 때는 기존 Performance Source와 Channel Control을 보존하고 타이밍만 병합한다. 전체 Direction Plan의 무손실 원본은 계속 OTIO로 유지한다.
