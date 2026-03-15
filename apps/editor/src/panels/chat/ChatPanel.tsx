import { useEditorStore } from "../../state/editorStore";

export const ChatPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const selectedClip = project.clips[ui.selectedClipId];
  const clipCaches = Object.values(project.caches).filter((cache) => cache.clipId === selectedClip.id);

  return (
    <section className="chat-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Chat Assistant</p>
          <h2>Workflow Guide</h2>
        </div>
      </div>

      <div className="chat-suggestions">
        <button
          onClick={() =>
            dispatch({
              type: "set-world",
              clipId: selectedClip.id,
              worldId: Object.keys(project.worlds)[0],
              worldMode: "structured_3d",
            })
          }
        >
          이 구간용 방 배경 만들어줘
        </button>
        <button onClick={() => dispatch({ type: "apply-shot-preset", clipId: selectedClip.id, preset: "CU" })}>
          이 컷에 CU 샷 프리셋 적용
        </button>
        <button
          onClick={() =>
            dispatch({
              type: "add-library-reference",
              clipId: selectedClip.id,
              libraryNodeId: project.libraryNodeIds[0],
              referenceType: "instance",
            })
          }
        >
          렌즈 패키지 인스턴스로 가져오기
        </button>
        <button
          onClick={() =>
            dispatch({
              type: "run-connector",
              connectorId: Object.keys(project.connectors)[0],
              clipId: selectedClip.id,
            })
          }
        >
          외부 모델 프록시 커넥터 실행
        </button>
      </div>

      <div className="stack">
        <h3>Recent Workflow</h3>
        {ui.workflowLog.map((entry) => (
          <div key={entry} className="preview-frame">
            {entry}
          </div>
        ))}
      </div>

      <div className="stack">
        <h3>Cache Status</h3>
        {clipCaches.map((cache) => (
          <div key={cache.id} className="edge-card">
            <strong>{cache.label}</strong>
            <span>{cache.kind}</span>
            <span>status: {cache.status}</span>
            <span>invalidated by: {cache.invalidatedByNodeIds.join(", ") || "-"}</span>
          </div>
        ))}
      </div>

      <div className="stack">
        <h3>External Connectors</h3>
        {Object.values(project.connectors).map((connector) => (
          <div key={connector.id} className="edge-card">
            <strong>{connector.name}</strong>
            <span>{connector.description}</span>
            <span>outputs: {connector.outputKinds.join(", ")}</span>
            <span>last run: {connector.lastRunAt ?? "never"}</span>
          </div>
        ))}
      </div>
    </section>
  );
};
