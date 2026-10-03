import { useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import { evaluateShotWorkflow } from "../../domain/workflow";
import { AgentOrchestrator, type AgentIntentType } from "../../application/services/agent/AgentOrchestrator";

export const AssistantPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();
  const [input, setInput] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const selectedClip = project.clips[ui.selectedClipId];
  const clipCaches = Object.values(project.caches).filter((cache) => cache.clipId === selectedClip.id);
  const shotWorkflow = evaluateShotWorkflow({
    clip: selectedClip,
    graph: project.clipGraphs[selectedClip.clipGraphId],
    nodes: project.nodes,
    worlds: project.worlds,
    caches: project.caches,
  });

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const detected = AgentOrchestrator.detectIntent(trimmed);
    if (!detected) {
      dispatch({ type: "assistant-message", message: trimmed });
      setInput("");
      return;
    }
    const plan = AgentOrchestrator.plan(detected, { project, selectedClip });
    if (detected === "render_shot") {
      if (!plan.requiresConfirmation) {
        const msg = plan.notes?.[0] ?? "샷 설정을 먼저 완료하세요.";
        dispatch({ type: "assistant-message", message: `렌더 보류: ${msg}` });
        setInput("");
        return;
      }
      const ok = typeof window !== "undefined" ? window.confirm(plan.confirmMessage ?? "Render shot?") : true;
      if (!ok) {
        dispatch({ type: "assistant-message", message: "렌더 요청이 취소되었습니다." });
        setInput("");
        return;
      }
      dispatch({ type: "submit-video-render", clipId: selectedClip.id });
      setInput("");
      return;
    }
    void AgentOrchestrator.execute(plan, (commands, logMessage) => {
      dispatch({ type: "agent-execute-commands", commands, logMessage });
    });
    setInput("");
  };

  const handleIntent = (intent: AgentIntentType) => {
    const plan = AgentOrchestrator.plan(intent, { project, selectedClip });
    if (intent === "render_shot") {
      if (!plan.requiresConfirmation) {
        const msg = plan.notes?.[0] ?? "샷 설정을 먼저 완료하세요.";
        dispatch({ type: "assistant-message", message: `렌더 보류: ${msg}` });
        return;
      }
      const ok = typeof window !== "undefined" ? window.confirm(plan.confirmMessage ?? "Render shot?") : true;
      if (!ok) {
        dispatch({ type: "assistant-message", message: "렌더 요청이 취소되었습니다." });
        return;
      }
      dispatch({ type: "submit-video-render", clipId: selectedClip.id });
      return;
    }
    void AgentOrchestrator.execute(plan, (commands, logMessage) => {
      dispatch({ type: "agent-execute-commands", commands, logMessage });
    });
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
            월드 연결, 다음 컷, 샷 프리셋, 렌더를 요청하세요. 샷 계약이 성립하기 전에는 렌더가 나가지 않습니다.
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
          onClick={() => handleIntent("link_world")}
        >
          이 구간용 방 배경 만들어줘
        </button>
        <button
          type="button"
          onClick={() => handleIntent("apply_shot_preset")}
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
        <button type="button" onClick={() => dispatch({ type: "add-empty-clip" })}>
          다음 컷 만들기
        </button>
        <button
          type="button"
          onClick={() => handleIntent("render_shot")}
          disabled={!shotWorkflow.readyForRender}
          title={!shotWorkflow.readyForRender ? shotWorkflow.blockingIssues[0] : undefined}
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
