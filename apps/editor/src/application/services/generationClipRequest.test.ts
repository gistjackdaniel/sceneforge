import { describe, it, expect } from "vitest";
import type { Project } from "../../domain/project/types";
import { createNodeBase } from "./nodeFactory";
import type { TimelineClip } from "../../domain/timeline/types";
import { createEmptyClipDraft } from "../../domain/generation/clipDraft";
import { getModelProfile, validateDraftAgainstProfile } from "../../domain/rendering/modelProfile";
import { CameraMovementDescriber } from "../../domain/rendering/cameraMovement";
import { buildGenerationRequestFromDraft } from "./generationClipRequest";
import type { NodeBase } from "../../domain/graph/types";
import { prepareGenerationHandoff } from "./generationHandoff";
import { applyCommand } from "../commands/apply";
import type { ApplyCommandContext } from "../commands/apply";
import type { DomainCommand } from "../commands/types";
import { MODEL_PROFILES } from "../../domain/rendering/modelProfile";
import { createMeshExampleWorld, createPointCloudExampleWorld, createSplatExampleWorld } from "../../domain/worlds/sampleWorlds";
import { shotId, type Shot } from "../../domain/shot";

const now = "2026-01-01T00:00:00.000Z";

const shotFixture = (): Shot => ({
  schemaVersion: 1,
  id: shotId("shot-001"),
  name: "Shot 01",
  time: { fps: 24, durationFrames: 96, origin: "clip_local" },
  subjects: [],
  camera: {
    status: "empty",
    lens: { focalLengthMm: 35 },
    interpolation: "linear",
    retiredTakeIds: [],
  },
  renders: [],
});

const projectFixture = (): { project: Project; clip: TimelineClip; shot: Shot } => {
  const clip: TimelineClip = {
    id: "clip-001",
    name: "Clip 01",
    start: 0,
    end: 96,
    duration: 96,
    startFrame: 0,
    durationFrames: 96,
    sourceType: "empty",
    clipGraphId: "g-1",
    cameraPathNodeId: "camera",
    performancePlanNodeId: "performance",
    cacheStatus: "valid",
  };
  const lensId = `node-${clip.id}-lens`;
  const nodes: Record<string, NodeBase> = {
    camera: createNodeBase({
      id: "camera",
      name: "Camera",
      kind: "CameraPathNode",
      category: "capture",
      parameters: {
        keyframes: [
          { frame: 0, position: [0, 1.5, 3], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
          { frame: 48, position: [0, 2.5, 3], rotation: [0, 0, 0, 1], focalLengthMm: 36 },
        ],
        interpolation: "linear",
        frameCount: 96,
      },
      timestamp: now,
      downstreamNodeIds: [],
    }),
    [lensId]: createNodeBase({
      id: lensId,
      name: "Lens",
      kind: "LensNode",
      category: "capture",
      parameters: { focalLengthMm: 36, sensorPreset: "full-frame" },
      timestamp: now,
    }),
    performance: createNodeBase({
      id: "performance",
      name: "Performance Plan",
      kind: "PerformancePlanNode",
      category: "performance",
      parameters: { sources: [], cues: [], audioGuide: {} },
      timestamp: now,
    }),
  };
  const project: Project = {
    id: "p1",
    name: "Test",
    createdAt: now,
    updatedAt: now,
    metrics: { editLatencyMs: 1, regenerationCount: 0, nodeReuseRate: 0, cacheHitRate: 0 },
    activeSequenceId: "seq-1",
    sequences: { "seq-1": { id: "seq-1", name: "Main", clipIds: [clip.id], playhead: 0, visibleRange: [0, 200] } },
    clips: { [clip.id]: clip },
    clipGraphs: { "g-1": { id: "g-1", clipId: clip.id, rootNodeId: "performance", nodeIds: ["performance", "camera", lensId], edges: [], previewFrames: [], finalFrames: [], keyframeNodeIds: [] } },
    nodes,
    references: {},
    dependencyMap: {
      downstreamByNodeId: { performance: [], camera: [] },
      clipsByNodeId: { performance: [clip.id], camera: [clip.id] },
      referencesByNodeId: {},
      cacheHashesByClipId: { [clip.id]: "h1" },
    },
    worlds: {},
    assets: {},
    caches: {},
    connectors: {},
    libraryNodeIds: [],
    clipDrafts: {},
    shots: { [clip.id]: shotFixture() },
  };
  return { project, clip, shot: project.shots![clip.id]! };
};

describe("Model profile validation", () => {
  it("enforces reference limits and resolution constraints", () => {
    const profile = getModelProfile("lyra-2.0");
    const result = validateDraftAgainstProfile({
      model: profile,
      width: 1280,
      height: 720,
      fps: 24,
      durationSeconds: 12, // too long
      outputCount: 5, // too many
      references: new Array(9).fill(0).map((_, i) => ({ kind: "image" as const })), // 9 images > perKind 8
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === "durationSeconds")).toBe(true);
    expect(result.issues.some((i) => i.field === "outputCount")).toBe(true);
    expect(result.issues.some((i) => i.field === "references.image")).toBe(true);
  });
});

describe("Camera movement description", () => {
  it("describes crane up for vertical moves", () => {
    const { project, clip } = projectFixture();
    const params = (project.nodes["camera"].parameters as any);
    expect(CameraMovementDescriber.describe(params)).toMatch(/crane up/i);
  });
});

describe("ClipDraft to GenerationRequest", () => {
  it("builds a request with Backbone v0.1 camera and pose conditions", () => {
    const { project, clip, shot } = projectFixture();
    const draft = createEmptyClipDraft(shot, { clipId: clip.id, prompt: "Walk forward", durationSeconds: 4, fps: 16, width: 1280, height: 720 });

    // Create a minimal SMPL-X pose node so exportBackboneSmplxForClip succeeds
    const poseNode = createNodeBase({
      id: "pose",
      name: "Actor Pose",
      kind: "ActorPoseNode",
      category: "performance",
      parameters: {
        actorElementId: "actor-a",
        interpolation: "slerp",
        keyframes: [
          { frame: 0, pose: { global_orient: [0, 0, 0], transl: [0, 0, 0], body_pose: Array(63).fill(0), left_hand_pose: Array(45).fill(0), right_hand_pose: Array(45).fill(0), jaw_pose: [0,0,0], expression: Array(10).fill(0) } },
          { frame: 48, pose: { global_orient: [0, 0, 0], transl: [0, 0, 0], body_pose: Array(63).fill(0), left_hand_pose: Array(45).fill(0), right_hand_pose: Array(45).fill(0), jaw_pose: [0,0,0], expression: Array(10).fill(0) } },
        ],
      },
      timestamp: now,
    });
    const projectWithPose: Project = { ...project, nodes: { ...project.nodes, pose: poseNode }, dependencyMap: {
      downstreamByNodeId: { performance: [], camera: [], pose: [] },
      clipsByNodeId: { performance: [clip.id], camera: [clip.id], pose: [clip.id] },
      referencesByNodeId: {},
      cacheHashesByClipId: { [clip.id]: "h1" },
    }};

    const { request, validation } = buildGenerationRequestFromDraft({
      project: projectWithPose,
      clip,
      nodes: projectWithPose.nodes,
      draft,
      shot,
    });
    expect(request.task).toBe("world_to_video");
    expect(request.fps).toBe(shot.time.fps);
    const camera = request.conditions.find((c) => c.type === "camera");
    expect(camera?.payload?.format).toBe("backbone_v0.1");
    const pose = request.conditions.find((c) => c.type === "pose");
    expect(pose?.payload?.format).toBe("backbone_v0.1");
    expect(validation.ok).toBe(true);
  });
});

describe("Image anchors: reference mode by default, hard only on toggle", () => {
  it("excludes images from hard conditions by default and sends soft guidance; toggling to hard moves to conditions", () => {
    const { project, clip, shot } = projectFixture();
    let draft = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 4, fps: 16, width: 1280, height: 720 });
    draft = { ...draft, references: [...(draft.references ?? []), { id: "img-1", kind: "image", assetId: "asset-img-1" }] };
    const { request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft, shot });
    expect(validation.ok).toBe(true);
    // No hard image conditions by default
    expect(request.conditions.some((c) => c.type === "image")).toBe(false);
    // Soft guidance present
    expect((request.backendOptions as any).softGuidanceImages?.length).toBe(1);
    expect((request.backendOptions as any).softGuidanceImages[0].assetId).toBe("asset-img-1");

    // Toggle to hard via DomainCommand (undoable)
    const ctx: ApplyCommandContext = { timestamp: now };
    const created = applyCommand({ ...project, clipDrafts: { [shot.id]: draft } } as Project, { type: "SET_DRAFT_IMAGE_MODE", clipId: clip.id, referenceId: "img-1", mode: "hard" } as DomainCommand, ctx);
    const hardened = created.project.clipDrafts![shot.id]!;
    const { request: req2, validation: val2 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: hardened, shot });
    expect(val2.ok).toBe(true);
    expect(req2.conditions.some((c) => c.type === "image" && c.assetId === "asset-img-1")).toBe(true);
    expect(((req2.backendOptions as any).softGuidanceImages ?? []).length).toBe(0);

    // Undo toggle
    const inverse = created.result.inverse!;
    const undone = applyCommand(created.project, inverse as DomainCommand, ctx);
    const reverted = undone.project.clipDrafts![shot.id]!;
    const { request: req3 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: reverted, shot });
    expect(req3.conditions.some((c) => c.type === "image")).toBe(false);
    expect((req3.backendOptions as any).softGuidanceImages?.length).toBe(1);
  });
});

describe("Model capability for image guidance/conditioning", () => {
  it("warns and drops soft guidance when unsupported; errors on hard when unsupported", () => {
    // Register a test-only profile without soft guidance and hard conditioning
    (MODEL_PROFILES as any)["no-soft"] = {
      id: "no-soft",
      label: "NoSoft",
      allowedResolutions: [{ width: 1280, height: 720, fps: [16, 24] }],
      maxDurationSeconds: 10,
      maxOutputCount: 4,
      referenceLimits: { total: 10, perKind: { image: 5 } },
      supportsSoftImageGuidance: false,
      supportsHardImageConditioning: true,
    };
    (MODEL_PROFILES as any)["no-hard"] = {
      id: "no-hard",
      label: "NoHard",
      allowedResolutions: [{ width: 1280, height: 720, fps: [16, 24] }],
      maxDurationSeconds: 10,
      maxOutputCount: 4,
      referenceLimits: { total: 10, perKind: { image: 5 } },
      supportsSoftImageGuidance: true,
      supportsHardImageConditioning: false,
    };

    const { project, clip, shot } = projectFixture();
    // Soft guidance unsupported
    let draft = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 4, fps: 16, width: 1280, height: 720, modelId: "no-soft" });
    draft = { ...draft, references: [{ id: "img-1", kind: "image", assetId: "asset-img-1" }] };
    const { request, validation } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft, shot });
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => /does not support soft image guidance/i.test(w))).toBe(true);
    expect(((request.backendOptions as any).softGuidanceImages ?? []).length).toBe(0);

    // Hard conditioning unsupported
    let draft2 = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 4, fps: 16, width: 1280, height: 720, modelId: "no-hard" });
    draft2 = { ...draft2, references: [{ id: "img-2", kind: "image", assetId: "asset-img-2", imageMode: "hard" }] };
    const { validation: v2 } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft: draft2, shot });
    expect(v2.ok).toBe(false);
    expect(v2.issues.some((i) => /does not support hard image conditioning/i.test(i.message))).toBe(true);
  });
});

describe("Generation handoff DTO", () => {
  it("hashes the pass without clip or shot ids and fails closed when the shot rate is missing", () => {
    const { project, clip, shot } = projectFixture();
    const valid = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 4, fps: 16, width: 1280, height: 720, prompt: "Walk forward" });
    const ok = prepareGenerationHandoff({ project, clip, nodes: project.nodes, draft: valid });
    if (!ok.ok) throw new Error("expected ok handoff");
    expect(ok.dto.clipId).toBe(clip.id);
    expect(ok.dto.depHash).toBe("h1");
    expect(ok.dto.request.fps).toBe(24);
    expect(ok.dto.cacheKey).not.toContain(clip.id);
    expect(ok.dto.cacheKey).not.toContain(shot.id);
    const again = prepareGenerationHandoff({ project, clip, nodes: project.nodes, draft: valid });
    if (!again.ok) throw new Error("expected ok handoff");
    expect(again.dto.cacheKey).toBe(ok.dto.cacheKey);

    const changed = prepareGenerationHandoff({
      project,
      clip,
      nodes: project.nodes,
      draft: { ...valid, prompt: "Turn around" },
    });
    if (!changed.ok) throw new Error("expected ok handoff");
    expect(changed.dto.cacheKey).not.toBe(ok.dto.cacheKey);

    const faster = prepareGenerationHandoff({
      project: { ...project, shots: { [clip.id]: { ...shot, time: { ...shot.time, fps: 12 } } } },
      clip,
      nodes: project.nodes,
      draft: valid,
    });
    if (!faster.ok) throw new Error("expected ok handoff");
    expect(faster.dto.cacheKey).not.toBe(ok.dto.cacheKey);

    const otherId = "clip-other";
    const otherClip: TimelineClip = { ...clip, id: otherId };
    const otherLensId = `node-${otherId}-lens`;
    const lensId = `node-${clip.id}-lens`;
    const other = prepareGenerationHandoff({
      project: {
        ...project,
        clips: { [otherId]: otherClip },
        shots: { [otherId]: shot },
        sequences: { "seq-1": { ...project.sequences["seq-1"]!, clipIds: [otherId] } },
        clipGraphs: { "g-1": { ...project.clipGraphs["g-1"]!, clipId: otherId, nodeIds: ["performance", "camera", otherLensId] } },
        nodes: {
          ...project.nodes,
          [otherLensId]: { ...project.nodes[lensId]!, id: otherLensId },
        },
      },
      clip: otherClip,
      nodes: {
        ...project.nodes,
        [otherLensId]: { ...project.nodes[lensId]!, id: otherLensId },
      },
      draft: { ...valid, clipId: otherId },
    });
    if (!other.ok) throw new Error("expected ok handoff");
    expect(other.dto.cacheKey).toBe(ok.dto.cacheKey);

    const invalid = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 999, fps: 120, width: 1024, height: 1024 });
    const fail = prepareGenerationHandoff({ project, clip, nodes: project.nodes, draft: invalid });
    expect(fail.ok).toBe(false);
    if (fail.ok) return;
    expect(fail.failure.code).toBe("VALIDATION_ERROR");
    expect(fail.failure.clipId).toBe(clip.id);
    expect(fail.failure.cacheKey).not.toBe(ok.dto.cacheKey);
    expect(fail.failure.cacheKey ?? "").not.toContain(clip.id);
    expect(fail.failure.retryable).toBe(false);

    const { shots: _shots, ...withoutShot } = project;
    const missing = prepareGenerationHandoff({ project: withoutShot, clip, nodes: project.nodes, draft: valid });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure.message).toBe("Shot time.fps is required.");
  });
});

describe("Backbone v0.1 unchanged when extensions are absent", () => {
  it("does not emit identity/speech/contact_events/render_settings by default", () => {
    const { project, clip, shot } = projectFixture();
    const draft = createEmptyClipDraft(shot, { clipId: clip.id, durationSeconds: 4, fps: 16, width: 1280, height: 720 });
    const { request } = buildGenerationRequestFromDraft({ project, clip, nodes: project.nodes, draft, shot });
    const newTypes = new Set(["identity", "speech", "contact_events", "render_settings"]);
    expect(request.conditions.some((c) => newTypes.has(c.type as string))).toBe(false);
    // Ensure existing v0.1 conditions still present
    expect(request.conditions.some((c) => c.type === "camera")).toBe(true);
    expect(request.conditions.some((c) => c.type === "pose")).toBe(true);
  });
});

describe("Prompt target lookup", () => {
  it("adds a world_reference only for a unique TargetResolver match", () => {
    const { project, clip, shot } = projectFixture();
    const world = createMeshExampleWorld();
    world.localizedNames = { ko: "아파트 거실", en: "Apartment Livingroom" };
    world.aliases = ["living room", "거실"];
    const draft = createEmptyClipDraft(shot, {
      clipId: clip.id,
      prompt: "Walk toward @거실",
      durationSeconds: 4,
      fps: 16,
      width: 1280,
      height: 720,
    });
    const { request, validation } = buildGenerationRequestFromDraft({
      project: { ...project, worlds: { [world.id]: world } },
      clip,
      nodes: project.nodes,
      draft,
      shot,
    });
    expect(validation.ok).toBe(true);
    const worldRef = request.conditions.find((condition) => condition.type === "world_reference");
    expect(worldRef?.assetId).toBe(world.id);
    expect(worldRef?.payload?.worldAssetId).toBe(world.id);
  });

  it("does not attach a world_reference when TargetResolver scores tie", () => {
    const { project, clip, shot } = projectFixture();
    const splat = createSplatExampleWorld();
    const points = createPointCloudExampleWorld();
    const draft = createEmptyClipDraft(shot, {
      clipId: clip.id,
      prompt: "@[Color Block]",
      durationSeconds: 4,
      fps: 16,
      width: 1280,
      height: 720,
    });
    const { request, validation } = buildGenerationRequestFromDraft({
      project: { ...project, worlds: { [splat.id]: splat, [points.id]: points } },
      clip,
      nodes: project.nodes,
      draft,
      shot,
    });
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.field === "prompt" && /more than one world target/.test(issue.message))).toBe(true);
    expect(request.conditions.some((condition) => condition.type === "world_reference")).toBe(false);
  });
});

describe("Draft and plan separation", () => {
  it("does not mutate camera path or lens when editing draft", () => {
    const { project, clip, shot } = projectFixture();
    const draft = createEmptyClipDraft(shot, { clipId: clip.id });
    const beforeCamera = JSON.stringify(project.nodes["camera"].parameters);
    const lensId = `node-${clip.id}-lens`;
    const beforeLens = JSON.stringify((project.nodes[lensId] as any).parameters);
    // Local edit to draft
    draft.width = 1920;
    draft.height = 1080;
    draft.prompt = "Run and jump";
    // Ensure nodes unchanged
    expect(JSON.stringify(project.nodes["camera"].parameters)).toBe(beforeCamera);
    expect(JSON.stringify((project.nodes[lensId] as any).parameters)).toBe(beforeLens);
  });
});

describe("Clip draft undo and shot identity", () => {
  it("restores prompt and references when undoing DISCARD_CLIP_DRAFT", () => {
    const { project, clip, shot } = projectFixture();
    const ctx: ApplyCommandContext = { timestamp: now };
    const reference = { id: "img-1", kind: "image" as const, assetId: "asset-img-1" };
    const created = applyCommand(project, { type: "CREATE_CLIP_DRAFT", clipId: clip.id }, ctx);
    const updated = applyCommand(
      created.project,
      { type: "UPDATE_CLIP_DRAFT", clipId: clip.id, patch: { prompt: "손을 들어", references: [reference] } },
      ctx,
    );
    expect(updated.project.clipDrafts?.[shot.id]?.prompt).toBe("손을 들어");
    expect(updated.project.clipDrafts?.[clip.id]).toBeUndefined();

    const discarded = applyCommand(updated.project, { type: "DISCARD_CLIP_DRAFT", clipId: clip.id }, ctx);
    expect(discarded.project.clipDrafts?.[shot.id]).toBeUndefined();
    expect(discarded.result.inverse?.type).toBe("CREATE_CLIP_DRAFT");

    const restored = applyCommand(discarded.project, discarded.result.inverse!, ctx);
    expect(restored.project.clipDrafts?.[shot.id]?.prompt).toBe("손을 들어");
    expect(restored.project.clipDrafts?.[shot.id]?.references).toEqual([reference]);
    expect(Object.keys(restored.project.clipDrafts ?? {})).toEqual([shot.id]);
  });

  it("keeps the draft on the same shot after the clip is moved, cut, deleted, and restored", () => {
    const { project, clip, shot } = projectFixture();
    const ctx: ApplyCommandContext = { timestamp: now };
    const created = applyCommand(project, { type: "CREATE_CLIP_DRAFT", clipId: clip.id }, ctx);
    const updated = applyCommand(
      created.project,
      {
        type: "UPDATE_CLIP_DRAFT",
        clipId: clip.id,
        patch: { prompt: "같은 샷", references: [{ id: "ref-1", kind: "image", assetId: "asset-1" }] },
      },
      ctx,
    );

    const movedClip = { ...updated.project.clips[clip.id]!, start: 24, startFrame: 24 };
    const moved: Project = { ...updated.project, clips: { [clip.id]: movedClip } };
    expect(moved.clipDrafts?.[shot.id]?.prompt).toBe("같은 샷");

    const cutId = "clip-cut";
    const cutClip: TimelineClip = { ...movedClip, id: cutId, duration: 48, durationFrames: 48 };
    const cut: Project = {
      ...moved,
      clips: { [cutId]: cutClip },
      shots: { [cutId]: shot },
      sequences: { "seq-1": { ...moved.sequences["seq-1"]!, clipIds: [cutId] } },
    };
    expect(cut.clipDrafts?.[shot.id]?.references[0]?.assetId).toBe("asset-1");
    expect(cut.clipDrafts?.[cutId]).toBeUndefined();

    const deleted: Project = {
      ...cut,
      clips: {},
      shots: {},
      sequences: { "seq-1": { ...cut.sequences["seq-1"]!, clipIds: [] } },
    };
    expect(deleted.clipDrafts?.[shot.id]?.prompt).toBe("같은 샷");

    const restoredId = "clip-restored";
    const restoredProject: Project = {
      ...deleted,
      clips: { [restoredId]: { ...cutClip, id: restoredId } },
      shots: { [restoredId]: shot },
      sequences: { "seq-1": { ...deleted.sequences["seq-1"]!, clipIds: [restoredId] } },
    };
    const edited = applyCommand(
      restoredProject,
      { type: "UPDATE_CLIP_DRAFT", clipId: restoredId, patch: { prompt: "복원 후" } },
      ctx,
    );
    expect(edited.result.ok).toBe(true);
    expect(edited.project.clipDrafts?.[shot.id]?.prompt).toBe("복원 후");
    expect(edited.project.clipDrafts?.[shot.id]?.references).toEqual([{ id: "ref-1", kind: "image", assetId: "asset-1" }]);
    expect(Object.keys(edited.project.clipDrafts ?? {})).toEqual([shot.id]);
  });
});

