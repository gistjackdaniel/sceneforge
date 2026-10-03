import { ReferenceBadge } from "../../components/ReferenceBadge";
import { CacheStatusBadge } from "../../components/CacheStatusBadge";
import { buildImpactSentence, getAffectedClips } from "../../core/dependency";
import { edgeSourceId, edgeTargetId } from "../../core/nodes/types";
import { useEditorStore } from "../../state/editorStore";

export const GraphPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const clip = project.clips[ui.selectedClipId];
  const graph = project.clipGraphs[clip.clipGraphId];
  const focusNodeId = ui.highlightedNodeIds[0] ?? ui.selectedNodeId;
  const focusNode = project.nodes[focusNodeId];
  const affectedClips = focusNode
    ? getAffectedClips(project.clips, project.dependencyMap, focusNode.id)
    : [];

  return (
    <section className="panel graph-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">ClipGraph Editor</p>
          <h2>{clip.name} Graph</h2>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => dispatch({ type: "set-main-panel", panel: "playback" })}>
            Back to Playback
          </button>
        </div>
        <div className="graph-summary">
          <span>{graph.nodeIds.length} nodes</span>
          <span>{graph.edges.length} edges</span>
          <span>{graph.keyframeNodeIds.length} keyframes</span>
        </div>
      </div>

      {focusNode && (
        <div className="impact-banner">
          <strong>{focusNode.name}</strong>
          <span>{buildImpactSentence(focusNode.name, affectedClips.map((item) => item.name))}</span>
        </div>
      )}

      <div className="graph-grid">
        <div className="graph-column">
          <h3>Nodes</h3>
          <div className="graph-list">
            {graph.nodeIds.map((nodeId) => {
              const node = project.nodes[nodeId];
              if (!node) {
                return null;
              }
              const referenceIds = project.dependencyMap.referencesByNodeId[node.id] ?? [];
              const nodeAffected = getAffectedClips(project.clips, project.dependencyMap, node.id);
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
                  <span>{node.status}</span>
                  <span>{node.category}</span>
                  <ReferenceBadge referenceType={node.referenceType} />
                  <span>refs: {referenceIds.length}</span>
                  {nodeAffected.length > 0 && <span>affected clips: {nodeAffected.length}</span>}
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
                  {project.nodes[edgeSourceId(edge)]?.name} →{" "}
                  {project.nodes[edgeTargetId(edge)]?.name}
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

        {affectedClips.length > 0 && (
          <div className="graph-column">
            <h3>Affected Clips</h3>
            <div className="graph-list">
              {affectedClips.map((affectedClip) => (
                <div key={affectedClip.id} className="edge-card">
                  <strong>{affectedClip.name}</strong>
                  <CacheStatusBadge status={affectedClip.cacheStatus} />
                  <span>
                    hash: {project.dependencyMap.cacheHashesByClipId[affectedClip.id] ?? "-"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
