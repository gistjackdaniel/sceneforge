import { useEditorStore } from "../../state/editorStore";

export const GraphPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const graph = project.clipGraphs[clip.clipGraphId];

  return (
    <section className="panel graph-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">ClipGraph Editor</p>
          <h2>{clip.name} Graph</h2>
        </div>
        <div className="graph-summary">
          <span>{graph.nodeIds.length} nodes</span>
          <span>{graph.edges.length} edges</span>
          <span>{graph.keyframeNodeIds.length} keyframes</span>
        </div>
      </div>

      <div className="graph-grid">
        <div className="graph-column">
          <h3>Nodes</h3>
          <div className="graph-list">
            {graph.nodeIds.map((nodeId) => {
              const node = project.nodes[nodeId];
              const referenceIds = project.dependencyMap.referencesByNodeId[node.id] ?? [];
              return (
                <button
                  key={node.id}
                  className={`graph-node ${ui.selectedNodeId === node.id ? "is-selected" : ""} ${
                    ui.highlightedNodeIds.includes(node.id) ? "is-highlighted" : ""
                  }`}
                  onClick={() => dispatch({ type: "select-node", nodeId: node.id })}
                >
                  <strong>{node.name}</strong>
                  <span>{node.kind}</span>
                  <span>{node.category}</span>
                  <span>reference: {node.referenceType}</span>
                  <span>refs: {referenceIds.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="graph-column">
          <h3>Edges</h3>
          <div className="graph-list">
            {graph.edges.map((edge) => (
              <div key={edge.id} className="edge-card">
                <strong>{edge.label}</strong>
                <span>
                  {project.nodes[edge.source]?.name} → {project.nodes[edge.target]?.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="graph-column">
          <h3>Dependency Map</h3>
          <div className="graph-list">
            {graph.nodeIds.map((nodeId) => (
              <div key={nodeId} className="edge-card">
                <strong>{project.nodes[nodeId]?.name}</strong>
                <span>
                  downstream: {(project.dependencyMap.downstreamByNodeId[nodeId] ?? []).length}
                </span>
                <span>clips: {(project.dependencyMap.clipsByNodeId[nodeId] ?? []).join(", ") || "-"}</span>
                <button onClick={() => dispatch({ type: "reveal-references", nodeId })}>
                  Reveal References
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
