import { CacheStatusBadge } from "../../components/CacheStatusBadge";
import { ReferenceBadge } from "../../components/ReferenceBadge";
import { buildImpactSentence, getAffectedClips } from "../../core/dependency";
import { REFERENCE_LABELS, type ReferenceType } from "../../core/references/types";
import { useEditorStore } from "../../state/editorStore";

const referenceTypes: ReferenceType[] = ["shared", "instance", "local"];

export const InspectorPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  const node = project.nodes[ui.selectedNodeId];
  const relatedReferences = Object.values(project.references).filter(
    (reference) => reference.sourceNodeId === node.id || reference.targetNodeId === node.id,
  );
  const affectedClips = getAffectedClips(project.clips, project.dependencyMap, node.id);
  const impactSentence = buildImpactSentence(
    node.name,
    affectedClips.map((clip) => clip.name),
  );
  const pending = ui.pendingRerender;
  const showApproval = pending?.nodeId === node.id;

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

      {showApproval && pending && (
        <div className="rerender-approval">
          <p>{pending.impactSentence}</p>
          <div className="stack compact">
            <div className="button-row wrap">
              <button onClick={() => dispatch({ type: "set-all-pending-rerender", selected: true })}>Select All</button>
              <button onClick={() => dispatch({ type: "set-all-pending-rerender", selected: false })}>Clear All</button>
            </div>
            <div className="affected-clips-readonly">
              <ul>
                {pending.affectedClipIds.map((clipId) => {
                  const clip = project.clips[clipId];
                  const selected = pending.selectedClipIds.includes(clipId);
                  return (
                    <li key={clipId}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => dispatch({ type: "toggle-pending-rerender-clip", clipId })}
                        />
                        <span>{clip?.name ?? clipId}</span>
                        {clip && <CacheStatusBadge status={clip.cacheStatus} />}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="muted">
              Selected {pending.selectedClipIds.length} / {pending.affectedClipIds.length} clip(s) for proxy re-render.
            </p>
            <div className="button-row wrap">
              <button onClick={() => dispatch({ type: "approve-partial-rerender" })}>
                Approve Partial Rerender ({pending.selectedClipIds.length})
              </button>
              <button onClick={() => dispatch({ type: "dismiss-partial-rerender" })}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

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
            <ReferenceBadge referenceType={node.referenceType} />
          </div>
        </div>

        <div className="stack">
          <h3>Reference Semantics</h3>
          <div className="button-row wrap">
            {referenceTypes.map((referenceType) => (
              <button
                key={referenceType}
                onClick={() =>
                  dispatch({
                    type: "set-node-reference-type",
                    nodeId: node.id,
                    referenceType,
                  })
                }
              >
                {REFERENCE_LABELS[referenceType]}
              </button>
            ))}
            {node.referenceType !== "local" && (
              <button onClick={() => dispatch({ type: "make-node-local", nodeId: node.id })}>
                Make Local
              </button>
            )}
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
          <h3>Linked References</h3>
          {relatedReferences.length === 0 && <p>이 노드와 연결된 참조가 없습니다.</p>}
          {relatedReferences.map((reference) => (
            <div key={reference.id} className="edge-card">
              <strong>{reference.id}</strong>
              <span>
                {reference.sourceNodeId} → {reference.targetNodeId}
              </span>
              <ReferenceBadge referenceType={reference.referenceType} />
              {reference.overridePatch && (
                <span>overrides: {Object.keys(reference.overridePatch).join(", ")}</span>
              )}
              <div className="button-row wrap">
                {referenceTypes.map((referenceType) => (
                  <button
                    key={referenceType}
                    onClick={() =>
                      dispatch({
                        type: "set-reference-type",
                        referenceId: reference.id,
                        referenceType,
                      })
                    }
                  >
                    {REFERENCE_LABELS[referenceType]}
                  </button>
                ))}
                <button onClick={() => dispatch({ type: "break-link", referenceId: reference.id })}>
                  Break Link
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "override-reference-value",
                      referenceId: reference.id,
                      patch: { lastOverrideAt: nowLabel() },
                    })
                  }
                >
                  Override Value
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="stack">
          <h3>Cache Impact</h3>
          <p className="impact-sentence">{impactSentence}</p>
          <p>
            Downstream nodes: {(project.dependencyMap.downstreamByNodeId[node.id] ?? []).length}
          </p>
          <p>Used in clips: {(project.dependencyMap.clipsByNodeId[node.id] ?? []).join(", ") || "-"}</p>
          {affectedClips.length > 0 && (
            <div className="affected-clips-readonly">
              <ul>
                {affectedClips.map((clip) => (
                  <li key={clip.id}>
                    {clip.name}{" "}
                    <CacheStatusBadge status={clip.cacheStatus} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const nowLabel = () => new Date().toISOString();
