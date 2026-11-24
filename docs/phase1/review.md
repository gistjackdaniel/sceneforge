# Phase 1 편집 검증

[15초 MP4](../../artifacts/phase1/SceneForge-Phase-1.mp4)에서 B가 손을 흔드는 샷과 고개 숙여 인사하는 샷을 같은 프레임으로 비교한다. A는 청록색, B는 주황색이다. [검증 결과](../../artifacts/phase1/verification.json)는 카메라 테이크, 배경 GLB의 SHA-256, A의 원본 루트 60프레임과 샷에서 평가한 루트 120프레임을 비교한다. [편집 전 상태](../../artifacts/phase1/before.json), [편집 후 상태](../../artifacts/phase1/after.json), [생성 입력](../../artifacts/phase1/conditions.json)을 함께 확인할 수 있다.

통합된 Stage에서 [Scene의 샷 편집](../../artifacts/phase1/scene-workspace.png)과 [Motion의 카메라 편집](../../artifacts/phase1/motion-workspace.png)은 같은 샷과 프레임을 사용한다.

## 에디터에서 확인하기

1. `apps/editor`에서 `npm run dev -- --configLoader runner`를 실행한다.
2. Stage의 **Scene**에서 **샷 선택**을 열고 **Phase 1 검증 샷**을 고른다. 샷을 재생하거나 **샷 프레임**을 45로 옮긴다.
3. **샷 편집**에서 **B 인사하기**를 누른다. 같은 프레임에서 B의 자세와 오른쪽의 3D 상태 비교 결과를 본다.
4. **Undo**와 **Redo**를 사용한다. **샷 모션 버전**에서 이전 리비전을 직접 선택할 수도 있다.
5. **Motion**을 열어 같은 샷에서 카메라를 조작한다. `K`로 현재 프레임에 카메라 포즈를 저장하거나 **Record**로 테이크를 녹화한다. **Scene**으로 돌아오면 그 카메라와 B의 편집을 함께 볼 수 있다.
6. 일반 샷에서도 **Scene**의 **샷 편집**을 열어 배경 GLB를 가져오고, 액터와 프레임 구간을 지정한다. 표정 모프가 있는 액터를 선택하면 **웹캠 표정 켜기**를 사용할 수 있다. 뷰포트에서 **샷 카메라**를 끄면 자유 뷰로 돌아간다.

새 프롬프트 생성은 로컬 Kimodo Python 런타임을 사용한다. 루트의 `.env.example`을 참고해 체크포인트 폴더와 텍스트 인코더 장치를 설정한다. Python 자동 탐지가 실패하면 `KIMODO_PYTHON`에 설치 경로를 지정한다. 포함된 검증 샷은 저장된 모델 출력으로 재생된다. [NVIDIA Kimodo 설치 안내](https://research.nvidia.com/labs/sil/projects/kimodo/docs/getting_started/quick_start.html)

생성 조건 JSON은 모션 클립 해시, 액터와 자산 리비전 ID, 프레임 구간을 저장한다. 생성한 클립은 실행 중인 에디터의 동일 출처 URL에서 제공된다. 업로드한 GLB는 가져온 브라우저 프로필의 IndexedDB에 저장된다.

## 증거 다시 만들기

Chrome, Playwright Core와 FFmpeg가 설치된 환경에서 `CHROME_PATH`, `PLAYWRIGHT_MODULE`, `FFMPEG_PATH`를 해당 경로로 설정한다. 프로젝트 루트에서 아래 명령을 순서대로 실행한다.

```text
node apps/editor/scripts/verify-phase1.mjs --capture
node apps/editor/scripts/render-phase1-demo.mjs
```
