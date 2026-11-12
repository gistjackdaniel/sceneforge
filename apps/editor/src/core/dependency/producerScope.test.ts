import { describe, expect, it } from "vitest";
import { applyRevisionPlan } from "../cache/invalidation";
import type { RenderCacheEntry } from "../cache/types";
import {
  buildDependencyFingerprint,
  interpretScopeEntry,
  normalizeProductionSelector,
  planRevisionScope,
  productionSelectorSchema,
  selectorMatches,
  selectorToQuery,
  type ProductionOutput,
} from "./index";

const ACT_A = "act_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ACT_B = "act_01BX5ZZKBKACTAV9WEVGEMMVSZ";

const fingerprint = () =>
  buildDependencyFingerprint({
    assetId: "world-apartment-livingroom",
    revisionId: "rev-1",
    modelVersion: "video-0.1",
    seed: 3,
    pass: { pose: "rest" },
  });

const output = (
  overrides: Partial<ProductionOutput> & Pick<ProductionOutput, "outputId" | "nodeId" | "cacheId" | "selector">,
): ProductionOutput => ({
  fingerprint: fingerprint(),
  constraint: "generative",
  computedAt: "2026-11-12T00:00:00.000Z",
  ...overrides,
});

const cacheEntry = (id: string): RenderCacheEntry => ({
  id,
  label: id,
  kind: "node_evaluation",
  status: "valid",
  updatedAt: "t0",
  invalidatedByNodeIds: [],
});

const rawSelectors = [
  { kind: "contact", contact_id: "handshake_01" },
  { kind: "motion", actor_id: "actor_B" },
  { kind: "root_motion", actor_id: "actor_A" },
  { kind: "contact_constraints", actor_id: "actor_B", part: "right_hand" },
  { kind: "background" },
  { kind: "camera_track" },
];

describe("action graph selectors", () => {
  it("normalizes raw selectors the same way through the schema and interpretScopeEntry", () => {
    rawSelectors.forEach((sample) => {
      const parsed = productionSelectorSchema.safeParse(sample);
      const normalized = normalizeProductionSelector(sample);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !normalized || normalized === "dependent") {
        return;
      }
      expect(normalized).toEqual(parsed.data);
      expect(interpretScopeEntry(sample)).toEqual({ query: selectorToQuery(parsed.data) });
    });
    expect(normalizeProductionSelector({ kind: "render_passes" })).toBe("dependent");
    expect(interpretScopeEntry({ kind: "render_passes" })).toEqual({ dependent: true });
    expect(productionSelectorSchema.safeParse({ kind: "contact", contactEventId: "handshake_01" }).success).toBe(false);
    const withActor = { kind: "contact", contact_id: "handshake_01", actor_id: "actor_A" };
    const parsed = productionSelectorSchema.safeParse(withActor);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(interpretScopeEntry(withActor)).toEqual({ query: selectorToQuery(parsed.data) });
    expect(selectorMatches(
      { kind: "contact", contactId: "handshake_01" },
      { kind: "contact", contactId: "handshake_01", actorId: "actor_A" },
    )).toBe(true);
    expect(selectorMatches(
      { kind: "contact", contactId: "cup_hold_01", actorId: "actor_A", part: "left_hand" },
      { kind: "contact", contactId: "handshake_01", actorId: "actor_A" },
    )).toBe(false);
  });

  it("keeps A's contact and root motion when only B's contact hand is recomputed", () => {
    const outputs = [
      output({
        outputId: "out-a-contact",
        nodeId: "contactA",
        cacheId: "cache-a-contact",
        selector: { kind: "contact", contactId: "actor_A:left_hand", actorId: "actor_A", part: "left_hand" },
      }),
      output({
        outputId: "out-a-root",
        nodeId: "rootA",
        cacheId: "cache-a-root",
        selector: { kind: "actor", actorId: "actor_A", motion: "root_motion" },
      }),
      output({
        outputId: "out-b-right",
        nodeId: "handB",
        cacheId: "cache-b-right",
        selector: { kind: "contact", contactId: "actor_B:right_hand", actorId: "actor_B", part: "right_hand" },
      }),
      output({
        outputId: "out-b-left",
        nodeId: "handBLeft",
        cacheId: "cache-b-left",
        selector: { kind: "contact", contactId: "actor_B:left_hand", actorId: "actor_B", part: "left_hand" },
      }),
    ];
    const plan = planRevisionScope(
      {
        shotId: "shot-contact",
        operation: "edit_contact_hand_pose",
        preserve: [{ kind: "root_motion", actor_id: "actor_A" }],
        recompute: [{ kind: "contact_constraints", actor_id: "actor_B", part: "right_hand" }],
      },
      { outputs, downstreamByNodeId: { contactA: [], rootA: [], handB: [], handBLeft: [] } },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds).toEqual(["out-b-right"]);
    expect(plan.preservedOutputIds).toContain("out-a-root");
    expect(plan.invalidateOutputIds).not.toContain("out-a-contact");
    expect(plan.invalidateOutputIds).not.toContain("out-b-left");
  });

  it("recomputes handshake_01 and its a/b parts, and keeps the other root motion and contacts", () => {
    const contactGraph = [
      {
        contact_id: "handshake_01",
        a: { actor_id: "actor_A", part: "right_hand" },
        b: { actor_id: "actor_B", part: "right_hand" },
      },
      {
        contact_id: "cup_hold_01",
        a: { actor_id: "actor_A", part: "left_hand" },
        b: { object_id: "cup" },
      },
    ];
    const outputs = [
      output({
        outputId: "out-handshake",
        nodeId: "handshake",
        cacheId: "cache-handshake",
        selector: { kind: "contact", contactId: "handshake_01" },
      }),
      output({
        outputId: "out-a-part",
        nodeId: "handA",
        cacheId: "cache-a-part",
        selector: { kind: "contact", actorId: "actor_A", part: "right_hand", instanceId: ACT_A },
      }),
      output({
        outputId: "out-b-part",
        nodeId: "handB",
        cacheId: "cache-b-part",
        selector: { kind: "contact", contactId: "handshake_01", actorId: "actor_B", part: "right_hand", instanceId: ACT_B },
      }),
      output({
        outputId: "out-a-root",
        nodeId: "rootA",
        cacheId: "cache-a-root",
        selector: { kind: "actor", actorId: "actor_A", motion: "root_motion", instanceId: ACT_A },
      }),
      output({
        outputId: "out-a-motion",
        nodeId: "motionA",
        cacheId: "cache-a-motion",
        selector: { kind: "actor", actorId: "actor_A", motion: "motion", instanceId: ACT_A },
      }),
      output({
        outputId: "out-cup",
        nodeId: "cup",
        cacheId: "cache-cup",
        selector: { kind: "contact", contactId: "cup_hold_01", actorId: "actor_A", part: "left_hand" },
      }),
    ];
    const caches = Object.fromEntries(outputs.map((item) => [item.cacheId, cacheEntry(item.cacheId)]));
    const plan = planRevisionScope(
      {
        shot_id: "shot-handshake",
        operation: "change_contact_effector",
        edit_id: "edit-handshake",
        base_graph_version: "graph-3",
        source: { type: "voice", transcript: "B의 오른손으로 악수" },
        preserve: [
          { kind: "root_motion", actor_id: "actor_A" },
          { kind: "motion", actor_id: "actor_A" },
          { kind: "contact", contact_id: "cup_hold_01" },
        ],
        recompute: [{ kind: "contact", contact_id: "handshake_01" }],
      },
      {
        outputs,
        downstreamByNodeId: { handshake: [], handA: [], handB: [], rootA: [], motionA: [], cup: [] },
        graphVersion: "graph-3",
        contact_graph: contactGraph,
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.invalidateOutputIds.sort()).toEqual(["out-a-part", "out-b-part", "out-handshake"]);
    expect(plan.invalidateOutputIds).not.toContain("out-a-root");
    expect(plan.invalidateOutputIds).not.toContain("out-a-motion");
    expect(plan.invalidateOutputIds).not.toContain("out-cup");
    expect(plan.preservedOutputIds).toEqual(expect.arrayContaining(["out-a-root", "out-a-motion", "out-cup"]));
    expect(plan.reasons.map((item) => item.reason)).toEqual([
      "edit_id=edit-handshake; source=voice:B의 오른손으로 악수",
      "edit_id=edit-handshake; source=voice:B의 오른손으로 악수",
      "edit_id=edit-handshake; source=voice:B의 오른손으로 악수",
    ]);
    const applied = applyRevisionPlan(caches, plan, "t1");
    expect(applied.applied).toBe(true);
    expect(applied.caches["cache-handshake"]?.status).toBe("invalid");
    expect(applied.caches["cache-a-part"]?.status).toBe("invalid");
    expect(applied.caches["cache-b-part"]?.status).toBe("invalid");
    expect(applied.caches["cache-a-root"]).toBe(caches["cache-a-root"]);
    expect(applied.caches["cache-cup"]?.status).toBe("valid");
    expect(applied.reasons?.[0]?.edit_id).toBe("edit-handshake");
    expect(applied.reasons?.[0]?.source).toEqual({ type: "voice", transcript: "B의 오른손으로 악수" });
  });

  it("does not touch the cache when a contact edit's instanceIds differ from contact_graph a/b", () => {
    const outputs = [
      output({
        outputId: "out-handshake",
        nodeId: "handshake",
        cacheId: "cache-handshake",
        selector: { kind: "contact", contactId: "handshake_01" },
      }),
      output({
        outputId: "out-a-root",
        nodeId: "rootA",
        cacheId: "cache-a-root",
        selector: { kind: "actor", actorId: "actor_A", motion: "root_motion", instanceId: ACT_A },
      }),
    ];
    const caches = Object.fromEntries(outputs.map((item) => [item.cacheId, cacheEntry(item.cacheId)]));
    const plan = planRevisionScope(
      {
        shotId: "shot-handshake",
        operation: "change_contact_effector",
        instanceIds: [ACT_A],
        preserve: [],
        recompute: [{ kind: "contact", contact_id: "handshake_01" }],
      },
      {
        outputs,
        downstreamByNodeId: { handshake: ["rootA"], rootA: [] },
        contact_graph: [
          {
            contact_id: "handshake_01",
            a: { actor_id: ACT_A, part: "right_hand" },
            b: { actor_id: ACT_B, part: "right_hand" },
          },
        ],
      },
    );
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.error !== "contact_instance_conflict") {
      return;
    }
    expect(plan.contactIds).toEqual(["handshake_01"]);
    expect(plan.instanceIds).toEqual([ACT_A]);
    expect(plan.contactGraphInstanceIds.sort()).toEqual([ACT_A, ACT_B].sort());
    const applied = applyRevisionPlan(caches, plan, "t1");
    expect(applied.applied).toBe(false);
    expect(applied.caches).toBe(caches);
    expect(applied.caches["cache-handshake"]?.status).toBe("valid");
    expect(applied.caches["cache-a-root"]?.status).toBe("valid");
    expect(applied.reasons).toBeUndefined();
  });

  it("leaves the cache untouched when base_graph_version is stale", () => {
    const outputs = [
      output({
        outputId: "out-b",
        nodeId: "actorB",
        cacheId: "cache-b",
        selector: { kind: "actor", actorId: "actor_B", motion: "motion" },
      }),
    ];
    const caches = { "cache-b": cacheEntry("cache-b") };
    const plan = planRevisionScope(
      {
        shotId: "shot-contact",
        operation: "edit_contact_hand_pose",
        instanceId: ACT_B,
        edit_id: "edit-stale",
        base_graph_version: "graph-1",
        source: { type: "text" },
        preserve: [],
        recompute: [{ kind: "motion", actor_id: "actor_B" }],
      },
      { outputs, downstreamByNodeId: { actorB: [] }, graphVersion: "graph-2" },
    );
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.error !== "stale_base_graph_version") {
      return;
    }
    expect(plan.base_graph_version).toBe("graph-1");
    expect(plan.graphVersion).toBe("graph-2");
    const applied = applyRevisionPlan(caches, plan, "t1");
    expect(applied.applied).toBe(false);
    expect(applied.caches).toBe(caches);
    expect(applied.caches["cache-b"]?.status).toBe("valid");
    expect(applied.reasons).toBeUndefined();
  });
});
