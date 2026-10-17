import type { ClipGraph } from "../project/clipGraph";
import type { Project } from "../project/types";
import type { NodeBase, NodeCategory, NodeKind } from "./types";

export interface NodeFinderMatch {
  nodeId: string;
  label: string;
  kind: NodeKind;
  category: NodeCategory;
  score: number;
}

/**
 * In-clip ClipGraph node finder.
 * - Pure domain helper — no UI/state dependencies.
 * - Scoped strictly to a single ClipGraph via clipGraphId.
 */
export class ClipGraphNodeFinder {
  /**
   * Return ranked matches for a free-text query within the given clip graph.
   * Matching fields: name, kind, category, id, tags.
   * All tokens must match (AND). Simple score-based ordering.
   */
  static filter(
    project: Project,
    clipGraphId: string,
    queryRaw: string,
  ): NodeFinderMatch[] {
    const query = queryRaw.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const graph: ClipGraph | undefined = project.clipGraphs[clipGraphId];
    if (!graph) {
      return [];
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    const matches: NodeFinderMatch[] = [];

    for (const nodeId of graph.nodeIds) {
      const node: NodeBase | undefined = project.nodes[nodeId];
      if (!node) continue;
      const haystack = [
        node.name,
        node.kind,
        node.category,
        node.id,
        ...(node.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();

      // Require all tokens to appear
      if (!tokens.every((t) => haystack.includes(t))) {
        continue;
      }

      // Basic scoring heuristic
      let score = 0;
      for (const t of tokens) {
        if (node.name.toLowerCase() === t || node.id.toLowerCase() === t) score += 8;
        if (node.name.toLowerCase().startsWith(t)) score += 5;
        if (node.kind.toLowerCase().startsWith(t)) score += 3;
        if (haystack.includes(t)) score += 1;
      }

      matches.push({
        nodeId: node.id,
        label: node.name,
        kind: node.kind,
        category: node.category,
        score,
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.label.localeCompare(b.label);
    });
    return matches;
  }

  /** Whether the given node belongs to the specified clip graph. */
  static isNodeInGraph(project: Project, clipGraphId: string, nodeId: string): boolean {
    const graph = project.clipGraphs[clipGraphId];
    if (!graph) return false;
    return graph.nodeIds.includes(nodeId);
  }
}

