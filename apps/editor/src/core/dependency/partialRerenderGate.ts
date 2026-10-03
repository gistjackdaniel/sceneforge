import { buildImpactSentence } from "./impactSentence";
import { getAffectedClips } from "./affectedClips";
import type { DependencyMap } from "../clipgraph/types";
import type { TimelineClip } from "../project/types";

export interface PendingRerenderGateState {
  nodeId: string;
  impactSentence: string;
  affectedClipIds: string[];
  selectedClipIds: string[];
}

/**
 * Helper for computing and manipulating the pre-queue partial re-render gate.
 *
 * Keep logic here instead of scattering module-level helpers.
 */
export class PartialRerenderGate {
  static computePending(
    nodeId: string,
    nodeName: string,
    clips: Record<string, TimelineClip>,
    dependencyMap: DependencyMap,
  ): PendingRerenderGateState | undefined {
    const affected = getAffectedClips(clips, dependencyMap, nodeId);
    if (affected.length === 0) {
      return undefined;
    }
    const affectedClipIds = affected.map((c) => c.id);
    const impactSentence = buildImpactSentence(
      nodeName,
      affected.map((c) => c.name),
    );
    return {
      nodeId,
      impactSentence,
      affectedClipIds,
      selectedClipIds: [...affectedClipIds],
    };
  }

  static toggleSelection(
    state: PendingRerenderGateState,
    clipId: string,
  ): PendingRerenderGateState {
    const selected = new Set(state.selectedClipIds);
    if (selected.has(clipId)) {
      selected.delete(clipId);
    } else {
      if (state.affectedClipIds.includes(clipId)) {
        selected.add(clipId);
      }
    }
    return { ...state, selectedClipIds: Array.from(selected) };
  }

  static setAll(
    state: PendingRerenderGateState,
    selected: boolean,
  ): PendingRerenderGateState {
    return {
      ...state,
      selectedClipIds: selected ? [...state.affectedClipIds] : [],
    };
  }

  static selectedCount(state: PendingRerenderGateState): number {
    return state.selectedClipIds.length;
  }
}

