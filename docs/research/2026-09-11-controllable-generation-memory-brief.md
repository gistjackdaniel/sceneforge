# Controllable Generation: Memory & Multi-View — 연구·구현 브리프 (2026‑09‑11)

작성일: 2026‑09‑11  
적용 범위: SceneForge MVP (PRD §18 Phase 1–4 우선), Lyra 2.0 연동은 connector adapter로 한정

본 문서는 현재 레포 상태와 Notion 연구 메모를 안전하게 요약하고, 즉시 레포에 반영할 항목과 연구 영역으로 남길 항목을 분리하여 제안 실험과 구현 우선순위를 명시한다. 외부 비밀 키·JWT 미디어 URL은 포함하지 않는다.


## 1) Today in repo — 관련 구현 현황 스냅샷

- Performance/Shot 분리 및 정책
  - `PerformancePlanNode` + `separationPolicy: "shot_and_performance"`
    - 파일: [`../../apps/editor/src/domain/performance/plan.ts`](../../apps/editor/src/domain/performance/plan.ts)
    - 성능 소스·큐·오디오 가이드 정규화와 diff 기반 invalidation 범위 산출을 제공

- ModelCondition + ModelConnector (렌더 계약 표준화)
  - 타입·정규화·검증:
    - `ModelCondition`, `RenderRequest`, `normalizeRenderRequest`, `validateRenderRequest`  
      파일: [`../../apps/editor/src/domain/rendering/request.ts`](../../apps/editor/src/domain/rendering/request.ts)
  - Connector 인터페이스와 Lyra adapter 래퍼:
    - 파일: [`../../apps/editor/src/infrastructure/connectors/lyra/modelConnector.ts`](../../apps/editor/src/infrastructure/connectors/lyra/modelConnector.ts)

- Capability negotiation (명시적 다운그레이드 기록)
  - 협상 로직: `negotiateDirectionCapabilities`  
    파일: [`../../apps/editor/src/domain/rendering/capabilities.ts`](../../apps/editor/src/domain/rendering/capabilities.ts)  
  - 사용 지점(예): Lyra world_to_video 입력 구성, Direction 패널 시각화
    - [`../../apps/editor/src/core/lyra/videoRenderInput.ts`](../../apps/editor/src/core/lyra/videoRenderInput.ts)  
    - [`../../apps/editor/src/panels/direction/DirectionPanel.tsx`](../../apps/editor/src/panels/direction/DirectionPanel.tsx)

- Cache kinds에 메모리/세그먼트 타입 포함
  - `CacheKind`에 `spatial_memory`, `generated_segment`, `stage_render_pass` 정의  
    파일: [`../../apps/editor/src/domain/rendering/types.ts`](../../apps/editor/src/domain/rendering/types.ts)  
  - 노드별 invalidation 타겟 매핑에 메모리/세그먼트 반영  
    파일: [`../../apps/editor/src/core/cache/invalidationRules.ts`](../../apps/editor/src/core/cache/invalidationRules.ts)

- Core/render stubs (렌더 파이프라인 연결 전 임시)
  - `runGenerativeRefinementStub`  
    파일: [`../../apps/editor/src/core/render/refinementStub.ts`](../../apps/editor/src/core/render/refinementStub.ts)
  - `createStageRenderPassStub`  
    파일: [`../../apps/editor/src/core/render/stageRenderPass.ts`](../../apps/editor/src/core/render/stageRenderPass.ts)


## 2) Today in Notion research — 안전 요약

- Long Context & Memory Mechanisms taxonomy
  - 시각 메모리(Visual), 공간 메모리(Spatial), 압축 메모리(Compressed), 암묵적 모델 메모리(Implicit Model Memory)로 분류.
  - 모델 내부 구조에 종속되지 않는 추상 레벨에서 조건·캐시·평가 기준을 정의할 필요.

- Multi-object + multi-view generation 실험
  - 다중 뷰 참조는 숨겨진 마크(hidden mark) 복구에 유의미한 개선을 보임.
  - object-back(객체의 등·후면)과 planted-orbit(배치된 공전) 구간은 여전히 난이도가 높음.
  - 모델·벤더 비종속을 유지하는 condition 노드 설계 원칙이 필요.

※ 연구 노트의 링크·토큰·비공개 리소스 URL은 본 문서에 포함하지 않음.


## 3) Split — 레포에 즉시 반영 vs 연구로 유지

- 레포에 지금 반영
  - Condition normalizer 강화
    - 다중 뷰/다중 객체 plate 입력을 `ModelCondition[]`으로 안전하게 패키징(프레임·시점 메타 포함)하고, connector 전송 전 스키마 검증(Zod) 추가.
  - Connector stubs 유지·보강
    - Lyra adapter 래퍼는 계속 stub 우선. capability 협상 결과를 명시적으로 계약 v2에 포함.
  - Typed memory slots on cache
    - `CacheKind = spatial_memory | generated_segment | stage_render_pass | …` 슬롯을 캐시 파이프라인에서 1급으로 취급하고 invalidation·rerender 범위를 채널/프레임 단위로 누적.
  - 문서
    - 본 브리프 + PRD 교차 링크 보강. Direction 협상/캐시 계층 도식 간단 추가(텍스트 우선).

- 연구로 유지(레포 미포함)
  - 벤더별 prompt pack·샘플 프롬프트 모음
  - 크레딧 게이팅 기반 reshoot 정책·UX 실험
  - 관련 논문 테이블화(벤치마크·지표·셋업) 원문 데이터


## 4) Proposed next experiments

1) Object-back gate를 1급 평가 항목으로 채택  
   - 시퀀스별로 object-back 리커버리 여부를 태깅·수집. 협상 결과(락/스트렝스/마스크)와 상관관계 기록.
   - 부분 재렌더 승인 UX에서 object-back 실패 구간을 먼저 제시.

2) Spatial memory cache wiring
   - `SpatialMemoryNode` 타깃 캐시(`spatial_memory`)를 런타임에서 실소비자(Stage/Refinement)로 연결.  
   - 캐시 키에 월드 버전·카메라·조명·배치 해시 포함(비-의도 필드는 키에서 배제; PRD 캐시 키 원칙 준수).

3) Multi-view plate packaging (벤더 특화 콜라주 해킹 금지)
   - 복수 시점 이미지를 `conditions: [{type:\"image\", payload:{view:\"front\"}}, …]` 꼴로 포장.  
   - 벤더별 콜라주 규약을 피하고, connector 측에서 안전 변환. 다운그레이드는 협상 로그에 남김.


## 5) WorldAsset — 패키징 정합성 주의

- World Generation과 스키마 충돌 금지. 필수 경로·메타는 `WorldAssetManifest`가 source of truth.  
- Lyra 레이어 경로는 connector-specific 확장으로만 취급한다(PRD §2.3–2.4).  
- 관련 타입: [`../../apps/editor/src/domain/worlds/types.ts`](../../apps/editor/src/domain/worlds/types.ts)
  - `visualLayer3dgsPath`, `surfaceMeshPath`, `spatialMemoryPath`, `generatedSegmentPath`, `…`


## 우선순위

| 우선 | 항목 | 기대 결과 |
|---:|---|---|
| 1 | Condition normalizer 다중뷰 패키징 + 검증 | 벤더 비종속 입력 계약 확립, 리그레션 방지 |
| 2 | Spatial memory cache 배선 | 부분 재렌더 범위 축소, 캐시 적중률 향상 |
| 3 | Capability 협상 로그 노출 보강 | 다운그레이드 원인 가시화, 디버깅 효율 |
| 4 | 문서 교차 링크 보강 | 팀 온보딩 속도 향상, 스펙 드리프트 감소 |
| 5 | Object-back 평가 게이트 | 실패 케이스 조기 발견·지표화 |


## 참고

- PRD: [`../../sceneforge_PRD.md`](../../sceneforge_PRD.md) — §11.5–11.6 캐시/무효화, §15 디렉터리 규칙, §18 단계 우선순위
- 이전 리서치 노트: [`./2026-08-31-shot-performance-control-landscape.md`](./2026-08-31-shot-performance-control-landscape.md)

