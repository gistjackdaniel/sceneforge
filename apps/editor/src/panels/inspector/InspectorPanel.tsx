import { REFERENCE_LABELS } from "../../core/references/types";
import { useEditorStore } from "../../state/editorStore";

export const InspectorPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const node = project.nodes[ui.selectedNodeId];
  const relatedReferences = Object.values(project.references).filter(
    (reference) => reference.sourceNodeId === node.id || reference.targetNodeId === node.id,
  );

  return (
    <section className="inspector-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>{node.name}</h2>
        </div>
        <button onClick={() => dispatch({ type: "reveal-references", nodeId: node.id })}>
          Reveal References
        </button>
      </div>

      <div className="stack">
        <div className="status-grid">
          <div>
            <span className="label">Kind</span>
            <strong>{node.kind}</strong>
          </div>
          <div>
            <span className="label">Category</span>
            <strong>{node.category}</strong>
          </div>
          <div>
            <span className="label">Scope</span>
            <strong>{node.scope}</strong>
          </div>
          <div>
            <span className="label">Reference</span>
            <strong>{node.referenceType}</strong>
          </div>
        </div>

        <div className="stack">
          <h3>Parameters</h3>
          {Object.entries(node.parameters).map(([key, value]) => (
            <label key={key} className="stack compact">
              <span>{key}</span>
              <input
                value={String(value)}
                onChange={(event) =>
                  dispatch({
                    type: "update-node-parameter",
                    nodeId: node.id,
                    key,
                    value: event.target.value,
                  })
                }
              />
            </label>
          ))}
        </div>

        <div className="stack">
          <h3>Reference Semantics</h3>
          {relatedReferences.length === 0 && <p>이 노드와 연결된 참조가 없습니다.</p>}
          {relatedReferences.map((reference) => (
            <div key={reference.id} className="edge-card">
              <strong>{reference.id}</strong>
              <span>
                {reference.sourceNodeId} → {reference.targetNodeId}
              </span>
              <span>{REFERENCE_LABELS[reference.referenceType]}</span>
              <div className="button-row wrap">
                <button
                  onClick={() =>
                    dispatch({
                      type: "set-reference-type",
                      referenceId: reference.id,
                      referenceType: "hard_link",
                    })
                  }
                >
                  Hard Link
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "set-reference-type",
                      referenceId: reference.id,
                      referenceType: "instance",
                    })
                  }
                >
                  Instance
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "set-reference-type",
                      referenceId: reference.id,
                      referenceType: "copy",
                    })
                  }
                >
                  Copy
                </button>
                <button onClick={() => dispatch({ type: "break-link", referenceId: reference.id })}>
                  Break Link
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="stack">
          <h3>Cache Impact</h3>
          <p>
            Downstream nodes: {(project.dependencyMap.downstreamByNodeId[node.id] ?? []).length}
          </p>
          <p>Used in clips: {(project.dependencyMap.clipsByNodeId[node.id] ?? []).join(", ") || "-"}</p>
        </div>
      </div>
    </section>
  );
};
