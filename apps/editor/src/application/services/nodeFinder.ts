import type { Project } from "../../domain/project/types";
import { ClipGraphNodeFinder } from "../../domain/graph/nodeFinder";
import type { EditorUiState } from "../../state/editorStore";

/** Application service for focusing a node from the in-clip finder. */
export class NodeFinderService {
  /** Focus a node if it belongs to the currently selected clip's graph. */
  static focusNodeInSelectedClip(project: Project, currentUi: EditorUiState, nodeId: string): EditorUiState {
    const selectedClip = project.clips[currentUi.selectedClipId];
    if (!selectedClip) {
      return currentUi;
    }
    const inScope = ClipGraphNodeFinder.isNodeInGraph(project, selectedClip.clipGraphId, nodeId);
    if (!inScope) {
      return currentUi;
    }
    return {
      ...currentUi,
      selectedNodeId: nodeId,
      highlightedNodeIds: [nodeId],
      mainPanel: "graph",
    };
  }
}

