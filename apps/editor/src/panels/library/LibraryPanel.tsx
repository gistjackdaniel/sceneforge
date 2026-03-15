import type { ReferenceType } from "../../core/references/types";
import { useEditorStore } from "../../state/editorStore";

const referenceTypes: ReferenceType[] = ["hard_link", "instance", "copy"];

export const LibraryPanel = () => {
  const {
    state: { project, ui },
    dispatch,
  } = useEditorStore();

  return (
    <section className="library-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Project / Sequence Library</p>
          <h2>Shared Node Library</h2>
        </div>
      </div>

      <div className="stack">
        {project.libraryNodeIds.map((nodeId) => {
          const node = project.nodes[nodeId];
          return (
            <div key={node.id} className="edge-card">
              <strong>{node.name}</strong>
              <span>{node.kind}</span>
              <span>{node.tags.join(", ") || "untagged"}</span>
              <div className="button-row wrap">
                {referenceTypes.map((referenceType) => (
                  <button
                    key={referenceType}
                    onClick={() =>
                      dispatch({
                        type: "add-library-reference",
                        clipId: ui.selectedClipId,
                        libraryNodeId: node.id,
                        referenceType,
                      })
                    }
                  >
                    Add as {referenceType}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
