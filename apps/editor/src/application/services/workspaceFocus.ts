import type { Project } from "../../domain/project/types";
import type { EditorUiState } from "../../state/editorStore";

/** Workspace focus helpers for navigating between main panes. */
export class WorkspaceFocus {
  /** Focus the ClipGraph for a given clip id while preserving timeline-first selection semantics. */
  static focusClipGraph(project: Project, currentUi: EditorUiState, clipId: string): EditorUiState {
    const clip = project.clips[clipId];
    if (!clip) {
      return currentUi;
    }
    const cameraNodeId = clip.cameraPathNodeId ?? `node-${clip.id}-trajectory`;
    return {
      ...currentUi,
      selectedClipId: clip.id,
      selectedNodeId: `node-${clip.id}-clip`,
      mainPanel: "graph",
      previewWorldId: undefined,
      highlightedNodeIds: [cameraNodeId, `node-${clip.id}-clip`].filter((id) => project.nodes[id]),
    };
  }
}

