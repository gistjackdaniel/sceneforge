import { useState } from "react";
import { useEditorStore } from "../../state/editorStore";

export const AssistantPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const [input, setInput] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const selectedClip = project.clips[ui.selectedClipId];
  const clipCaches = Object.values(project.caches).filter((cache) => cache.clipId === selectedClip.id);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    dispatch({ type: "assistant-message", message: trimmed });
    setInput("");
  };

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <p className="eyebrow">AI Assistant</p>
        <h2>Scene Director</h2>
      </div>

      <div className="assistant-messages">
        {ui.assistantMessages.length === 0 && (
          <div className="assistant-bubble assistant-bubble-system">
            월드 배치, 샷 프리셋, 렌더 승인을 자연어로 요청하세요.
          </div>
        )}
        {ui.assistantMessages.map((message) => (
          <div
            key={message.id}
            className={`assistant-bubble assistant-bubble-${message.role}`}
          >
            {message.text}
          </div>
        ))}
      </div>

      <div className="assistant-chips">
        <button
          type="button"
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
        <button
          type="button"
          onClick={() =>
            dispatch({ type: "apply-shot-preset", clipId: selectedClip.id, preset: "CU" })
          }
        >
          CU 샷 적용
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: "add-library-reference",
              clipId: selectedClip.id,
              libraryNodeId: project.libraryNodeIds[0],
              referenceType: "instance",
            })
          }
        >
          렌즈 인스턴스 가져오기
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "submit-video-render", clipId: selectedClip.id })}
        >
          키프레임 기반 렌더
        </button>
      </div>

      <div className="assistant-input-row">
        <input
          placeholder="Ask SceneForge..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              sendMessage();
            }
          }}
        />
        <button type="button" className="btn-primary" onClick={sendMessage}>
          Send
        </button>
      </div>

      <button
        type="button"
        className="assistant-details-toggle"
        onClick={() => setShowDetails((value) => !value)}
      >
        {showDetails ? "Hide" : "Show"} cache & connectors
      </button>

      {showDetails && (
        <div className="assistant-details">
          {clipCaches.map((cache) => (
            <div key={cache.id} className="edge-card">
              <strong>{cache.label}</strong>
              <span>{cache.kind}</span>
              <span>status: {cache.status}</span>
            </div>
          ))}
          {Object.values(project.connectors).map((connector) => (
            <div key={connector.id} className="edge-card">
              <strong>{connector.name}</strong>
              <span>{connector.description}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};
