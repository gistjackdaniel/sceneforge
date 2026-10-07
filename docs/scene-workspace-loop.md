# 검증 루프

기준은 [sceneforge_PRD.md](../sceneforge_PRD.md)다. 노드 그래프와 멀티컷 IDE는 이 루프의 대상이 아니다.

한 루프는 최소 기능 하나를 고친 뒤 아래를 다시 통과하는 것이다.

```text
npx tsc -p tsconfig.json --noEmit
npx vitest run
```

화면 (`apps/editor`, `npx vite --port 4173`, 너비 1280 이상):

1. Stage만 보인다. Graph, Inspector, Direction, World Gen, Timeline이 없다.
2. 3D 자산을 추가하면 Subjects에 남고, 새로고침 후에도 남는다.
3. Pose prompt를 적으면 그 문장이 남는다. 비우고 Motion에서 `K`를 누르면 그 프레임의 explicit pose가 남는다.
4. 카메라 키가 없으면 Generate video가 꺼져 있다. Motion에서 `K`로 궤적을 남기면 켜진다.
5. Generate 실패 이유가 상단에 보인다.

```text
날짜:
변경:
tsc ( )  vitest ( )
화면 1–5:
다음에 볼 것:
```
