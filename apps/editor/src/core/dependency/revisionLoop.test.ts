import { describe, expect, it } from "vitest";
import { hashValue } from "../../domain/graph/cacheKey";
import type { TimelineClip } from "../../domain/timeline/types";
import type { RenderCacheEntry } from "../../domain/rendering/types";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "../../domain/worlds/sampleWorlds";
import { bindWorldPhase1Selectors } from "../../application/services/worldPhase1Validation";
import { applyRevisionPlan, invalidateOutdatedCaches } from "../cache/invalidation";
import {
  buildDependencyFingerprint,
  detectOutdatedOutputs,
  hashNormalized,
  persistentInstanceIdSchema,
  planRevisionScope,
  productionSelectorSchema,
  recordComputedOutput,
  type OutputProvenanceStore,
  type ProductionOutput,
} from "./index";

const WORLD_ID = "world-apartment-livingroom";
const INSTANCE_A = "actor_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const INSTANCE_B = "actor_01BX5ZZKBKACTAV9WEVGEMMVSZ";

const fingerprint = (
  overrides: Partial<Parameters<typeof buildDependencyFingerprint>[0]> = {},
) =>
  buildDependencyFingerprint({
    assetId: WORLD_ID,
    revisionId: "rev-1",
    modelVersion: "render-0.1",
    seed: 7,
    pass: { contactId: "handshake_01", hand: "left" },
    ...overrides,
  });

const output = (overrides: Partial<ProductionOutput> & Pick<ProductionOutput, "outputId" | "nodeId" | "cacheId" | "selector">): ProductionOutput => ({
  fingerprint: fingerprint(),
  constraint: "generative",
  computedAt: "2026-11-04T00:00:00.000Z",
  ...overrides,
});

const cacheEntry = (id: string, clipId: string): RenderCacheEntry => ({
  id,
  clipId,
  label: id,
  kind: "proxy",
  status: "valid",
  updatedAt: "t0",
  invalidatedByNodeIds: [],
});

const clip = (
  id: string,
  clipGraphId: string,
  proxyCacheId: string,
  finalCacheId: string,
): TimelineClip => ({
  id,
  name: id,
  start: 0,
  end: 48,
  duration: 48,
  sourceType: "generated",
  clipGraphId,
  cacheStatus: "valid",
  proxyCacheId,
  finalCacheId,
});

const handshakeShot = () => {
  const outputs: ProductionOutput[] = [
    output({
      outputId: "out-camera",
      nodeId: "camera",
      cacheId: "cache-camera",
      selector: { kind: "camera_track", cameraTrackId: "phone-take-1" },
    }),
    output({
      outputId: "out-set",
      nodeId: "set",
      cacheId: "cache-set",
      selector: { kind: "set_layout", setLayoutId: "room" },
    }),
    output({
      outputId: "out-actor-a",
      nodeId: "actorA",
      cacheId: "cache-actor-a",
      selector: { kind: "actor", actorId: "actor_A", motion: "root_motion" },
      constraint: "geometry_locked",
    }),
    output({
      outputId: "out-actor-b",
      nodeId: "actorB",
      cacheId: "cache-actor-b",
      selector: { kind: "actor", actorId: "actor_B", motion: "motion" },
      constraint: "geometry_locked",
    }),
    output({
      outputId: "out-contact",
      nodeId: "contact",
      cacheId: "cache-contact",
      selector: { kind: "contact", contactId: "handshake_01" },
      constraint: "geometry_locked",
    }),
    output({
      outputId: "out-render-b",
      nodeId: "renderB",
      cacheId: "cache-render-b",
      selector: { kind: "render_pass", renderPassId: "beauty_b" },
    }),
    output({
      outputId: "out-render-a",
      nodeId: "renderA",
      cacheId: "cache-render-a",
      selector: { kind: "render_pass", renderPassId: "beauty_a" },
    }),
    output({
      outputId: "out-face",
      nodeId: "lockedFace",
      cacheId: "cache-face",
      selector: { kind: "render_pass", renderPassId: "face_b" },
      constraint: "hard_locked",
    }),
  ];
  const downstreamByNodeId = {
    camera: [],
    set: [],
    actorA: ["renderA"],
    actorB: ["contact", "lockedFace"],
    contact: ["renderB"],
    renderA: [],
    renderB: [],
    lockedFace: [],
  };
  const caches: Record<string, RenderCacheEntry> = {
    "cache-camera": cacheEntry("cache-camera", "clip-shot"),
    "cache-set": cacheEntry("cache-set", "clip-plate"),
    "cache-actor-a": cacheEntry("cache-actor-a", "clip-plate"),
    "cache-actor-b": cacheEntry("cache-actor-b", "clip-shot"),
    "cache-contact": cacheEntry("cache-contact", "clip-shot"),
    "cache-render-b": cacheEntry("cache-render-b", "clip-shot"),
    "cache-render-a": cacheEntry("cache-render-a", "clip-plate"),
    "cache-face": cacheEntry("cache-face", "clip-shot"),
  };
  const clips = {
    "clip-shot": clip("clip-shot", "graph-shot", "cache-camera", "cache-render-b"),
    "clip-plate": clip("clip-plate", "graph-plate", "cache-set", "cache-actor-a"),
  };
  return { outputs, downstreamByNodeId, caches, clips };
};

const contactHandEdit = {
  shot_id: "shot_003",
  operation: "change_contact_effector",
  actor_id: "actor_B",
  target_actor_id: "actor_A",
  contact_event_id: "handshake_01",
  new_effector: "right_hand",
  preserve: ["camera_track", "actor_A_root_motion", "set_layout"],
  recompute: ["actor_B_motion", "contact_constraints", "dependent_render_passes"],
};

describe("dependency hash and selectors", () => {
  it("hashes objects by sorted keys and keeps array order", () => {
    expect(hashNormalized({ b: 1, a: { d: 2, c: 3 } })).toBe(
      hashNormalized({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(hashNormalized([1, 2])).not.toBe(hashNormalized([2, 1]));
    expect(hashValue({ b: 1, a: 2 })).toBe(hashNormalized({ a: 2, b: 1 }));
  });

  it("uses contact/contactId and optional persistent instance ids", () => {
    expect(productionSelectorSchema.safeParse({ kind: "contact", contactId: "handshake_01" }).success).toBe(true);
    expect(productionSelectorSchema.safeParse({ kind: "contact", contactEventId: "handshake_01" }).success).toBe(false);
    expect(persistentInstanceIdSchema.safeParse(INSTANCE_A).success).toBe(true);
    expect(persistentInstanceIdSchema.safeParse("actor_not-an-ulid").success).toBe(false);
    const left = fingerprint({ pass: { hand: "right", contactId: "handshake_01" } });
    const right = fingerprint({ pass: { contactId: "handshake_01", hand: "right" } });
    expect(left.passHash).toBe(right.passHash);
  });
});

describe("outdated dependency keys", () => {
  const recordedOutput = output({
    outputId: "out-actor-b",
    nodeId: "actorB",
    cacheId: "cache-actor-b",
    selector: { kind: "actor", actorId: "actor_B", motion: "motion", instanceId: INSTANCE_A },
    fingerprint: fingerprint({ instanceId: INSTANCE_A, seed: 11, modelVersion: "model-a" }),
  });
  const stableOutput = output({
    outputId: "out-camera",
    nodeId: "camera",
    cacheId: "cache-camera",
    selector: { kind: "camera_track" },
    fingerprint: fingerprint({ seed: 11, modelVersion: "model-a" }),
  });

  const storeOf = (items: ProductionOutput[]) => {
    let store: OutputProvenanceStore = {};
    items.forEach((item) => {
      const recorded = recordComputedOutput(store, item);
      expect(recorded.ok).toBe(true);
      if (recorded.ok) {
        store = recorded.store;
      }
    });
    return store;
  };

  it("keeps a node fresh when the recorded fingerprint is reused", () => {
    const store = storeOf([recordedOutput, stableOutput]);
    const detection = detectOutdatedOutputs(store, {
      "out-actor-b": recordedOutput.fingerprint,
      "out-camera": stableOutput.fingerprint,
    });
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated).toEqual([]);
    expect(detection.freshOutputIds).toEqual(["out-actor-b", "out-camera"]);
    expect(store["out-actor-b"]?.fingerprint).toEqual(recordedOutput.fingerprint);
  });

  it("marks only the seed change and leaves the other output cached", () => {
    const store = storeOf([recordedOutput, stableOutput]);
    const detection = detectOutdatedOutputs(store, {
      "out-actor-b": { ...recordedOutput.fingerprint, seed: 99 },
      "out-camera": stableOutput.fingerprint,
    });
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.freshOutputIds).toEqual(["out-camera"]);
    expect(detection.outdated).toEqual([
      {
        outputId: "out-actor-b",
        nodeId: "actorB",
        outdated: true,
        changes: [
          {
            key: "seed",
            previous: 11,
            current: 99,
            reason: "seed가 11에서 99로 바뀌었습니다.",
          },
        ],
      },
    ]);

    const caches = {
      "cache-actor-b": cacheEntry("cache-actor-b", "clip-shot"),
      "cache-camera": cacheEntry("cache-camera", "clip-shot"),
    };
    const applied = invalidateOutdatedCaches(caches, detection, [recordedOutput, stableOutput], "t1");
    expect(applied.applied).toBe(true);
    expect(applied.caches["cache-actor-b"]?.status).toBe("invalid");
    expect(applied.caches["cache-camera"]?.status).toBe("valid");
    expect(caches["cache-actor-b"]?.status).toBe("valid");
  });

  it("marks only the model version change", () => {
    const store = storeOf([recordedOutput, stableOutput]);
    const detection = detectOutdatedOutputs(store, {
      "out-actor-b": { ...recordedOutput.fingerprint, modelVersion: "model-b" },
      "out-camera": stableOutput.fingerprint,
    });
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated.map((item) => item.changes)).toEqual([
      [
        {
          key: "modelVersion",
          previous: "model-a",
          current: "model-b",
          reason: "model version이 model-a에서 model-b로 바뀌었습니다.",
        },
      ],
    ]);
    expect(detection.freshOutputIds).toEqual(["out-camera"]);
  });

  it("marks only the pass hash change", () => {
    const store = storeOf([recordedOutput]);
    const next = fingerprint({
      instanceId: INSTANCE_A,
      seed: 11,
      modelVersion: "model-a",
      pass: { contactId: "handshake_01", hand: "right" },
    });
    const detection = detectOutdatedOutputs(store, { "out-actor-b": next });
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated[0]?.changes.map((change) => change.key)).toEqual(["passHash"]);
    expect(detection.outdated[0]?.changes[0]?.previous).toBe(recordedOutput.fingerprint.passHash);
    expect(detection.outdated[0]?.changes[0]?.current).toBe(next.passHash);
  });

  it("reports an asset revision change when the persistent instance id changes", () => {
    const store = storeOf([recordedOutput]);
    const next = fingerprint({ instanceId: INSTANCE_B, seed: 11, modelVersion: "model-a" });
    const detection = detectOutdatedOutputs(store, { "out-actor-b": next });
    expect(detection.ok).toBe(true);
    if (!detection.ok) {
      return;
    }
    expect(detection.outdated[0]?.changes).toEqual([
      {
        key: "assetRevision",
        previous: recordedOutput.fingerprint.assetRevision,
        current: next.assetRevision,
        reason: `asset revision이 바뀌었습니다: instance ${INSTANCE_A}에서 ${INSTANCE_B}로.`,
      },
    ]);
  });
});

describe("preserve / recompute revision scope", () => {
  it("invalidates B's contact hand change and keeps camera, set, and actor A cached", () => {
    const shot = handshakeShot();
    const plan = planRevisionScope(contactHandEdit, {
      outputs: shot.outputs,
      downstreamByNodeId: shot.downstreamByNodeId,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.shotId).toBe("shot_003");
    expect(plan.invalidateCacheIds.sort()).toEqual(["cache-actor-b", "cache-contact", "cache-render-b"]);
    expect(plan.preservedOutputIds.sort()).toEqual(["out-actor-a", "out-camera", "out-set"]);
    expect(plan.hardLockedOutputIds).toEqual(["out-face"]);
    expect(plan.invalidateOutputIds).not.toContain("out-render-a");

    const applied = applyRevisionPlan(shot.caches, plan, "t1", shot.clips);
    expect(applied.applied).toBe(true);
    expect(applied.caches["cache-camera"]?.status).toBe("valid");
    expect(applied.caches["cache-set"]?.status).toBe("valid");
    expect(applied.caches["cache-actor-a"]?.status).toBe("valid");
    expect(applied.caches["cache-render-a"]?.status).toBe("valid");
    expect(applied.caches["cache-face"]?.status).toBe("valid");
    expect(applied.caches["cache-actor-b"]?.status).toBe("invalid");
    expect(applied.caches["cache-contact"]?.status).toBe("invalid");
    expect(applied.caches["cache-render-b"]?.status).toBe("invalid");
    expect(shot.caches["cache-render-b"]?.status).toBe("valid");
    expect(applied.clips?.["clip-shot"]?.clipGraphId).toBe("graph-shot");
    expect(applied.clips?.["clip-shot"]?.cacheStatus).toBe("invalid");
    expect(applied.clips?.["clip-plate"]?.clipGraphId).toBe("graph-plate");
    expect(applied.clips?.["clip-plate"]?.cacheStatus).toBe("valid");
  });

  it("keeps a downstream contact cached when preserve names it and recompute does not", () => {
    const shot = handshakeShot();
    const plan = planRevisionScope(
      {
        shotId: "shot_003",
        operation: "change_contact_effector",
        preserve: [{ kind: "contact", contactId: "handshake_01" }],
        recompute: ["actor_B_motion"],
      },
      { outputs: shot.outputs, downstreamByNodeId: shot.downstreamByNodeId },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds).toContain("out-actor-b");
    expect(plan.invalidateOutputIds).not.toContain("out-contact");
    expect(plan.preservedOutputIds).toContain("out-contact");
  });

  it("invalidates one persistent instance and its shared downstream, leaving the other instance cached", () => {
    const shot = handshakeShot();
    const scopedActor = output({
      outputId: "out-actor-b",
      nodeId: "actorB",
      cacheId: "cache-actor-b",
      selector: { kind: "actor", actorId: "actor_B", motion: "motion", instanceId: INSTANCE_A },
      fingerprint: fingerprint({ instanceId: INSTANCE_A }),
      constraint: "geometry_locked",
    });
    const other = output({
      outputId: "out-actor-b-other",
      nodeId: "actorBOther",
      cacheId: "cache-actor-b-other",
      selector: { kind: "actor", actorId: "actor_B", motion: "motion", instanceId: INSTANCE_B },
      fingerprint: fingerprint({ instanceId: INSTANCE_B }),
    });
    const outputs = [
      ...shot.outputs.filter((item) => item.outputId !== "out-actor-b"),
      scopedActor,
      other,
    ];
    const plan = planRevisionScope(
      { ...contactHandEdit, instance_id: INSTANCE_A },
      {
        outputs,
        downstreamByNodeId: { ...shot.downstreamByNodeId, actorBOther: [] },
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds).toContain("out-actor-b");
    expect(plan.invalidateOutputIds).toContain("out-contact");
    expect(plan.invalidateOutputIds).not.toContain("out-actor-b-other");
    const caches = {
      ...shot.caches,
      "cache-actor-b-other": cacheEntry("cache-actor-b-other", "clip-shot"),
    };
    const applied = applyRevisionPlan(caches, plan, "t1");
    expect(applied.caches["cache-actor-b"]?.status).toBe("invalid");
    expect(applied.caches["cache-actor-b-other"]?.status).toBe("valid");
    expect(applied.caches["cache-camera"]?.status).toBe("valid");
  });

  it("returns a conflict and does not change cache when preserve and recompute name the same target", () => {
    const shot = handshakeShot();
    const plan = planRevisionScope(
      {
        ...contactHandEdit,
        preserve: ["camera_track", "actor_A_root_motion", "set_layout", "actor_B_motion"],
        recompute: ["actor_B_motion", "contact_constraints", "dependent_render_passes"],
      },
      { outputs: shot.outputs, downstreamByNodeId: shot.downstreamByNodeId },
    );
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.error !== "preserve_recompute_conflict") {
      return;
    }
    expect(plan.message).toContain("충돌");
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        outputId: "out-actor-b",
        nodeId: "actorB",
        preserve: ["actor_B_motion"],
        recompute: ["actor_B_motion"],
      }),
    ]);
    const applied = applyRevisionPlan(shot.caches, plan, "t1", shot.clips);
    expect(applied.applied).toBe(false);
    expect(applied.caches).toBe(shot.caches);
    expect(Object.values(applied.caches).every((entry) => entry.status === "valid")).toBe(true);
    expect(shot.clips["clip-shot"].clipGraphId).toBe("graph-shot");
    expect(shot.clips["clip-shot"].cacheStatus).toBe("valid");
  });
});

describe("world lane phase 1 selectors", () => {
  it("binds selectors to WorldAsset.id through TargetResolver and the shared pass hash", () => {
    const world = createMeshExampleWorld();
    world.localizedNames = { ko: "아파트 거실", en: "Apartment Livingroom" };
    const selectors = [
      { kind: "actor", actorId: "actor_B", motion: "motion" },
      { kind: "contact", contactId: "handshake_01" },
    ];
    const bound = bindWorldPhase1Selectors({
      worlds: { [world.id]: world },
      assetRef: "거실",
      ctx: { selectionIds: [], locale: "ko" },
      selectors,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    expect(bound.bindings.every((binding) => binding.assetId === world.id)).toBe(true);
    const reversed = bindWorldPhase1Selectors({
      worlds: { [world.id]: world },
      assetRef: world.id,
      selectors: [...selectors].reverse(),
    });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) {
      return;
    }
    expect(reversed.passHash).toBe(bound.passHash);
    expect(reversed.passHash).toBe(hashNormalized(
      [...bound.bindings]
        .map((binding) => ({
          assetId: binding.assetId,
          scopeToken: binding.scopeToken,
          selector: binding.selector,
        }))
        .sort((left, right) => left.scopeToken.localeCompare(right.scopeToken)),
    ));
  });

  it("rejects an element id and an ambiguous name instead of inventing an asset id", () => {
    const world = createMeshExampleWorld();
    const elementId = world.elements[0]?.id ?? "elem-missing";
    const missing = bindWorldPhase1Selectors({
      worlds: { [world.id]: world },
      selectors: [{ kind: "contact", contactId: "handshake_01", assetId: elementId }],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe("unresolved_asset");
      expect(missing.issues[0]?.message).toContain("WorldAsset.id");
    }

    const splat = createSplatExampleWorld();
    const points = createPointCloudExampleWorld();
    const ambiguous = bindWorldPhase1Selectors({
      worlds: { [splat.id]: splat, [points.id]: points },
      assetRef: "Color Block",
      selectors: [{ kind: "object", objectId: "cup" }],
    });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.issues[0]?.message).toContain("여러 WorldAsset");
    }
  });
});
