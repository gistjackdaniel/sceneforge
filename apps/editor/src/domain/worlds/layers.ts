import type { WorldAsset } from "./types";
import type { Sequence, TimelineClip } from "../timeline/types";

export type WorldLayerScope = "master" | "sequence" | "clip";

export interface WorldOverrideLayer {
  id: string;
  scope: WorldLayerScope;
  worldId: string;
  targetId?: string;
  patch: Record<string, unknown>;
}

export interface ResolvedShotState {
  worldId: string;
  world?: WorldAsset;
  layers: WorldOverrideLayer[];
  resolved: Record<string, unknown>;
  cameraFrame?: number;
}

const mergePatch = (
  base: Record<string, unknown>,
  patch?: Record<string, unknown>,
): Record<string, unknown> => ({
  ...base,
  ...(patch ?? {}),
});

/**
 * Master World → Sequence Override → Clip Override → Resolved Shot State (PRD §2.5).
 * Clip overrides never mutate the master world object.
 */
export const resolveShotState = (input: {
  world?: WorldAsset;
  sequence?: Sequence;
  clip?: TimelineClip;
  cameraFrame?: number;
}): ResolvedShotState => {
  const worldId = input.clip?.linkedWorldId ?? input.world?.id ?? "";
  const layers: WorldOverrideLayer[] = [];
  let resolved: Record<string, unknown> = {
    worldId,
    name: input.world?.name,
    representation: input.world?.representation,
  };

  if (input.world) {
    layers.push({
      id: `master-${input.world.id}`,
      scope: "master",
      worldId: input.world.id,
      patch: {},
    });
  }

  if (input.sequence?.worldOverride) {
    layers.push({
      id: `sequence-${input.sequence.id}`,
      scope: "sequence",
      worldId,
      targetId: input.sequence.id,
      patch: input.sequence.worldOverride,
    });
    resolved = mergePatch(resolved, input.sequence.worldOverride);
  }

  if (input.clip?.worldOverride) {
    layers.push({
      id: `clip-${input.clip.id}`,
      scope: "clip",
      worldId,
      targetId: input.clip.id,
      patch: input.clip.worldOverride,
    });
    resolved = mergePatch(resolved, input.clip.worldOverride);
  }

  return {
    worldId,
    world: input.world,
    layers,
    resolved,
    cameraFrame: input.cameraFrame,
  };
};
